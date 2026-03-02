/**
 * @module Services/Templates/Email
 *
 * Templates d'emails transactionnels liés aux paiements.
 * Chaque template retourne { subject, html }.
 *
 * Pourquoi des templates dédiés dans le payment-service :
 * - Le payment-service est responsable de notifier après paiement
 * - Indépendance vis-à-vis du notification-service (futur)
 * - Changement de template sans impacter les autres services
 */

/**
 * Style de base réutilisable.
 * Utilise des tables HTML pour la compatibilité Outlook.
 */
const getBaseTemplate = (content, title) => `
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        body { margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f4f4; }
        .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
        .header { background-color: #000000; padding: 30px 20px; text-align: center; }
        .header h1 { color: #ffffff; margin: 0; font-size: 24px; font-weight: 600; }
        .content { padding: 40px 30px; color: #333333; line-height: 1.6; }
        .content h2 { color: #000000; font-size: 20px; margin-bottom: 20px; }
        .content p { margin: 15px 0; font-size: 15px; }
        .order-details { background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin: 25px 0; }
        .order-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e0e0e0; }
        .order-row:last-child { border-bottom: none; }
        .order-label { font-weight: 600; color: #666666; }
        .order-value { color: #000000; font-weight: 500; }
        .badge { display: inline-block; padding: 6px 12px; border-radius: 4px; font-size: 13px; font-weight: 600; margin: 10px 0; }
        .badge-paid { background-color: #d4edda; color: #155724; }
        .badge-cancelled { background-color: #f8d7da; color: #721c24; }
        .button { display: inline-block; padding: 14px 32px; background-color: #000000; color: #ffffff !important; text-decoration: none; border-radius: 5px; font-weight: 600; margin: 20px 0; }
        .footer { background-color: #f9f9f9; padding: 30px 20px; text-align: center; color: #999999; font-size: 13px; }
        .footer a { color: #666666; text-decoration: none; }
    </style>
</head>
<body>
    <table class="container" role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
        <tr><td class="header"><h1>🛍️ ECOM-WATCH</h1></td></tr>
        <tr><td class="content">${content}</td></tr>
        <tr>
            <td class="footer">
                <p>Vous recevez cet email car vous avez effectué une commande sur notre boutique.</p>
                <p><a href="#">Suivre ma commande</a> • <a href="#">Nous contacter</a></p>
                <p style="margin-top: 20px;">© ${new Date().getFullYear()} ECOM-WATCH. Tous droits réservés.</p>
            </td>
        </tr>
    </table>
</body>
</html>
`;

const formatPrice = (amount) =>
    new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount);

const formatDate = (date) =>
    new Intl.DateTimeFormat('fr-FR', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
    }).format(new Date(date));

export const emailTemplates = {

    /**
     * Confirmation de commande payée.
     * Envoyé après réception du webhook `checkout.session.completed`.
     */
    orderConfirmation: (orderData) => {
        const content = `
            <h2>✅ Commande confirmée !</h2>
            <p>Bonjour,</p>
            <p>Nous avons bien reçu votre paiement et votre commande est confirmée.</p>
            <div class="order-details">
                <div class="order-row">
                    <span class="order-label">Numéro de commande</span>
                    <span class="order-value">#${orderData.orderNumber || orderData.id}</span>
                </div>
                <div class="order-row">
                    <span class="order-label">Date</span>
                    <span class="order-value">${formatDate(orderData.createdAt || new Date())}</span>
                </div>
                <div class="order-row">
                    <span class="order-label">Montant total</span>
                    <span class="order-value">${formatPrice(orderData.totalAmount)}</span>
                </div>
                <div class="order-row">
                    <span class="order-label">Statut</span>
                    <span class="badge badge-paid">PAYÉE</span>
                </div>
            </div>
            ${orderData.shippingAddress ? `
                <p><strong>Adresse de livraison :</strong><br>
                ${orderData.shippingAddress.street || orderData.shippingAddress.address || ''}<br>
                ${orderData.shippingAddress.postalCode || orderData.shippingAddress.zipCode || ''} ${orderData.shippingAddress.city || ''}<br>
                ${orderData.shippingAddress.country || 'France'}</p>
            ` : ''}
            <p>Nous préparons votre commande. Vous recevrez un email dès expédition.</p>
            <a href="${process.env.CLIENT_URL}/orders/${orderData.id}" class="button">Suivre ma commande</a>
        `;

        return {
            subject: `Confirmation de votre commande #${orderData.orderNumber || orderData.id}`,
            html: getBaseTemplate(content, 'Commande confirmée'),
        };
    },

    /**
     * Notification d'annulation suite à une session Stripe expirée.
     * Rassure le client qu'aucun débit n'a été effectué.
     */
    orderCancelled: (orderData) => {
        const content = `
            <h2>❌ Session de paiement expirée</h2>
            <p>Bonjour,</p>
            <p>Votre session de paiement pour la commande ci-dessous a expiré. Aucun montant n'a été débité.</p>
            <div class="order-details">
                <div class="order-row">
                    <span class="order-label">Numéro de commande</span>
                    <span class="order-value">#${orderData.orderNumber || orderData.id}</span>
                </div>
                <div class="order-row">
                    <span class="order-label">Montant</span>
                    <span class="order-value">${formatPrice(orderData.totalAmount)}</span>
                </div>
                <div class="order-row">
                    <span class="order-label">Statut</span>
                    <span class="badge badge-cancelled">ANNULÉE</span>
                </div>
            </div>
            <p>Vous pouvez recommander depuis notre boutique si vous le souhaitez.</p>
            <a href="${process.env.CLIENT_URL}/shop" class="button">Retourner à la boutique</a>
        `;

        return {
            subject: `Votre commande #${orderData.orderNumber || orderData.id} a expiré`,
            html: getBaseTemplate(content, 'Session expirée'),
        };
    },
};