/**
 * @module Controller/Payment
 *
 * Gère les sessions de paiement Stripe/PayPal et les webhooks associés.
 * Supporte les paiements en mode guest et authentifié.
 */
import { paymentService } from '../services/payment.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { AppError } from '../utils/appError.js';
import { ENV } from '../config/environment.js';

const CLIENT_URL = ENV.clientUrl;

/**
 * Valide le format d'un Stripe Session ID pour éviter l'injection dans le HTML de redirection.
 * Stripe génère des IDs au format cs_(test|live)_<alphanumérique>.
 */
const isValidStripeSessionId = (id) => /^cs_(test|live)_[a-zA-Z0-9]+$/.test(id ?? '');

class PaymentController {
    /**
     * Initialise une session de paiement Stripe.
     * Accessible en mode guest (req.user undefined) et authentifié.
     */
    createCheckoutSession = asyncHandler(async (req, res) => {
        const { orderId } = req.params;

        if (!orderId) {
            throw new AppError('Order ID manquant', HTTP_STATUS.BAD_REQUEST);
        }

        const session = await paymentService.createSession(orderId, req.user);

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: {
                checkoutUrl: session.url,
                sessionId: session.id,
                isGuestCheckout: !req.user,
            },
        });
    });

    /**
     * Traite les webhooks Stripe.
     * Route publique : l'authenticité est garantie par la signature HMAC Stripe,
     * pas par un token JWT.
     */
    handleStripeWebhook = asyncHandler(async (req, res) => {
        const signature = req.headers['stripe-signature'];

        if (!signature) {
            throw new AppError('Signature Stripe manquante', HTTP_STATUS.BAD_REQUEST);
        }

        if (!req.rawBody) {
            throw new AppError(
                'Configuration serveur incorrecte : rawBody manquant',
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }

        await paymentService.processStripeWebhook(req.rawBody, signature);

        res.status(HTTP_STATUS.OK).json({ received: true });
    });

    /**
     * Traite les webhooks PayPal.
     */
    handlePayPalWebhook = asyncHandler(async (req, res) => {
        await paymentService.processPayPalWebhook(req.body, req.headers);
        res.status(HTTP_STATUS.OK).json({ status: 'success' });
    });

    /**
     * Vérifie le statut du paiement (polling post-redirection Stripe).
     * Accessible en mode guest et authentifié.
     */
    checkStatus = asyncHandler(async (req, res) => {
        const { orderId } = req.params;
        const { email } = req.query;

        if (!orderId) {
            throw new AppError('Order ID manquant', HTTP_STATUS.BAD_REQUEST);
        }

        const paymentStatus = await paymentService.getPaymentStatus(orderId, req.user, email);

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: {
                paymentStatus,
                checkedAt: new Date().toISOString(),
                isGuestCheckout: !req.user,
            },
        });
    });

    /**
     * Page de succès après paiement (retour Stripe).
     *
     * Redirection via <meta http-equiv="refresh"> plutôt qu'un script inline.
     * Un script inline serait bloqué par la CSP (script-src 'self') sans unsafe-inline
     * ni hash explicite — et assouplir la CSP uniquement pour cette page
     * affaiblirait l'ensemble du service.
     *
     * Le session_id est validé avant injection dans le HTML (prévention XSS).
     */
    handleSuccess = asyncHandler(async (req, res) => {
        const { session_id } = req.query;

        const safeSessionId = isValidStripeSessionId(session_id) ? session_id : '';
        const redirectUrl = `${CLIENT_URL}/checkout/success${safeSessionId ? `?session_id=${safeSessionId}` : ''}`;

        res.send(`
            <!DOCTYPE html>
            <html lang="fr">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="refresh" content="2; url=${redirectUrl}">
                <title>Paiement réussi - ECOM WATCH</title>
                <style>
                    body { font-family: sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #fdfbf7; }
                    .container { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); text-align: center; }
                    h1 { color: #2ecc71; margin-bottom: 1rem; }
                    p { color: #666; margin-bottom: 2rem; }
                    .loader { border: 3px solid #f3f3f3; border-top: 3px solid #000; border-radius: 50%; width: 20px; height: 20px; animation: spin 1s linear infinite; margin: 0 auto; }
                    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>Paiement Validé</h1>
                    <p>Votre commande est confirmée. Redirection en cours...</p>
                    <div class="loader"></div>
                </div>
            </body>
            </html>
        `);
    });

    /**
     * Page d'annulation après abandon de paiement (retour Stripe).
     *
     * Stripe redirige ici via cancel_url (configurée dans payment.service.js).
     * Cette page affiche un message de confirmation puis redirige automatiquement
     * vers le panier du frontend via <meta http-equiv="refresh">.
     *
     * Même stratégie que handleSuccess :
     *   - Pas de script inline (bloqué par CSP script-src 'self')
     *   - orderId transmis en query param pour permettre au frontend de retrouver
     *     la commande concernée et de la remettre au statut exploitable.
     *
     * orderId est validé (UUID regex) avant injection dans l'URL de redirection
     * pour prévenir toute injection dans le meta refresh.
     */
    handleCancel = asyncHandler(async (req, res) => {
        const { orderId } = req.query;

        // Validation stricte de l'orderId avant injection dans le HTML.
        // Un orderId invalide est silencieusement ignoré — l'utilisateur
        // est redirigé vers le panier sans paramètre superflu.
        const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const safeOrderId = orderId && UUID_REGEX.test(orderId) ? orderId : null;

        const cancelUrl = safeOrderId
            ? `${CLIENT_URL}/checkout/cancel?orderId=${safeOrderId}`
            : `${CLIENT_URL}/cart`;

        res.send(`
            <!DOCTYPE html>
            <html lang="fr">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="refresh" content="2; url=${cancelUrl}">
                <title>Paiement annulé - ECOM WATCH</title>
                <style>
                    body { font-family: sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #fdfbf7; }
                    .container { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); text-align: center; }
                    h1 { color: #e74c3c; margin-bottom: 1rem; }
                    p { color: #666; margin-bottom: 2rem; }
                    .loader { border: 3px solid #f3f3f3; border-top: 3px solid #e74c3c; border-radius: 50%; width: 20px; height: 20px; animation: spin 1s linear infinite; margin: 0 auto; }
                    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>Paiement annulé</h1>
                    <p>Aucun débit n'a été effectué. Redirection vers votre panier...</p>
                    <div class="loader"></div>
                </div>
            </body>
            </html>
        `);
    });
}

export const paymentController = new PaymentController();