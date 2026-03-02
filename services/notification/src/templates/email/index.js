/**
 * @module Templates/Email
 *
 * Source unique de vérité pour tous les templates d'emails transactionnels.
 * Centraliser ici évite la duplication actuelle entre auth/order/payment.
 *
 * Chaque template retourne { subject, html }.
 * Le style utilise des tables HTML pour la compatibilité Outlook.
 */

// ── Utilitaires de formatage ─────────────────────────────────────────────────

const formatPrice = (amount) =>
    new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount ?? 0);

const formatDate = (date) =>
    new Intl.DateTimeFormat('fr-FR', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
    }).format(new Date(date));

// ── Template de base ─────────────────────────────────────────────────────────

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
        .badge-paid      { background-color: #d4edda; color: #155724; }
        .badge-shipped   { background-color: #cce5ff; color: #004085; }
        .badge-delivered { background-color: #d4edda; color: #155724; }
        .badge-cancelled { background-color: #f8d7da; color: #721c24; }
        .button { display: inline-block; padding: 14px 32px; background-color: #000000; color: #ffffff !important; text-decoration: none; border-radius: 5px; font-weight: 600; margin: 20px 0; }
        .footer { background-color: #f9f9f9; padding: 30px 20px; text-align: center; color: #999999; font-size: 13px; }
        .footer a { color: #666666; text-decoration: none; }
        @media only screen and (max-width: 600px) {
            .content { padding: 30px 20px !important; }
        }
    </style>
</head>
<body>
    <table class="container" role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
        <tr><td class="header"><h1>🛍️ ECOM-WATCH</h1></td></tr>
        <tr><td class="content">${content}</td></tr>
        <tr>
            <td class="footer">
                <p>Vous recevez cet email car vous avez effectué une action sur notre boutique.</p>
                <p>
                    <a href="#">Suivre ma commande</a> •
                    <a href="#">Nous contacter</a> •
                    <a href="#">Politique de retour</a>
                </p>
                <p style="margin-top: 20px;">© ${new Date().getFullYear()} ECOM-WATCH. Tous droits réservés.</p>
            </td>
        </tr>
    </table>
</body>
</html>
`;

// ── Bloc adresse de livraison réutilisable ───────────────────────────────────

const renderShippingAddress = (shippingAddress) => {
    if (!shippingAddress) return '';
    return `
        <p><strong>Adresse de livraison :</strong><br>
        ${shippingAddress.street || shippingAddress.address || ''}<br>
        ${shippingAddress.postalCode || shippingAddress.zipCode || ''} ${shippingAddress.city || ''}<br>
        ${shippingAddress.country || 'France'}</p>
    `;
};

// ── Templates ────────────────────────────────────────────────────────────────

export const emailTemplates = {

    /**
     * Confirmation de commande après paiement Stripe validé.
     * Déclenché par le webhook `checkout.session.completed`.
     */
    orderConfirmation: (orderData, clientUrl) => {
        const content = `
            <h2>✅ Commande confirmée !</h2>
            <p>Bonjour,</p>
            <p>Nous avons bien reçu votre paiement. Votre commande est en cours de préparation.</p>
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
            ${renderShippingAddress(orderData.shippingAddress)}
            <p>Vous recevrez un email dès que votre commande sera expédiée.</p>
            <a href="${clientUrl}/orders/${orderData.id}" class="button">Suivre ma commande</a>
        `;
        return {
            subject: `Confirmation de votre commande #${orderData.orderNumber || orderData.id}`,
            html: getBaseTemplate(content, 'Commande confirmée'),
        };
    },

    /**
     * Notification d'annulation — session Stripe expirée ou annulation manuelle.
     * Rassure le client qu'aucun débit n'a été effectué si applicable.
     */
    orderCancelled: (orderData, clientUrl, reason = null) => {
        const isExpired = reason === 'checkout.session.expired';
        const content = `
            <h2>${isExpired ? '❌ Session de paiement expirée' : '❌ Commande annulée'}</h2>
            <p>Bonjour,</p>
            <p>${
                isExpired
                    ? 'Votre session de paiement a expiré. <strong>Aucun montant n\'a été débité.</strong>'
                    : 'Votre commande a été annulée.'
            }</p>
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
            <p>Vous pouvez passer une nouvelle commande depuis notre boutique.</p>
            <a href="${clientUrl}/shop" class="button">Retourner à la boutique</a>
        `;
        return {
            subject: `Votre commande #${orderData.orderNumber || orderData.id} — ${isExpired ? 'session expirée' : 'annulée'}`,
            html: getBaseTemplate(content, 'Commande annulée'),
        };
    },

    /**
     * Notification d'expédition avec numéro de suivi.
     */
    orderShipped: (orderData, shipmentData, clientUrl) => {
        const content = `
            <h2>🚚 Votre commande est en route !</h2>
            <p>Bonjour,</p>
            <p>Votre commande vient d'être expédiée et est en chemin vers vous.</p>
            <div class="order-details">
                <div class="order-row">
                    <span class="order-label">Numéro de commande</span>
                    <span class="order-value">#${orderData.orderNumber || orderData.id}</span>
                </div>
                <div class="order-row">
                    <span class="order-label">Statut</span>
                    <span class="badge badge-shipped">EXPÉDIÉE</span>
                </div>
                ${shipmentData?.trackingNumber ? `
                <div class="order-row">
                    <span class="order-label">Numéro de suivi</span>
                    <span class="order-value">${shipmentData.trackingNumber}</span>
                </div>` : ''}
                ${shipmentData?.carrier ? `
                <div class="order-row">
                    <span class="order-label">Transporteur</span>
                    <span class="order-value">${shipmentData.carrier}</span>
                </div>` : ''}
                ${shipmentData?.estimatedDelivery ? `
                <div class="order-row">
                    <span class="order-label">Livraison estimée</span>
                    <span class="order-value">${formatDate(shipmentData.estimatedDelivery)}</span>
                </div>` : ''}
            </div>
            <a href="${clientUrl}/orders/${orderData.id}" class="button">Suivre ma commande</a>
        `;
        return {
            subject: `Votre commande #${orderData.orderNumber || orderData.id} est expédiée !`,
            html: getBaseTemplate(content, 'Commande expédiée'),
        };
    },

    /**
     * Confirmation de livraison.
     */
    orderDelivered: (orderData, clientUrl) => {
        const content = `
            <h2>📦 Commande livrée !</h2>
            <p>Bonjour,</p>
            <p>Votre commande a bien été livrée. Nous espérons qu'elle vous satisfait.</p>
            <div class="order-details">
                <div class="order-row">
                    <span class="order-label">Numéro de commande</span>
                    <span class="order-value">#${orderData.orderNumber || orderData.id}</span>
                </div>
                <div class="order-row">
                    <span class="order-label">Statut</span>
                    <span class="badge badge-delivered">LIVRÉE</span>
                </div>
            </div>
            <p>Si vous avez des questions ou souhaitez retourner un article, notre équipe est disponible.</p>
            <a href="${clientUrl}/orders/${orderData.id}" class="button">Voir ma commande</a>
        `;
        return {
            subject: `Votre commande #${orderData.orderNumber || orderData.id} a été livrée`,
            html: getBaseTemplate(content, 'Commande livrée'),
        };
    },

    /**
     * Email de bienvenue envoyé après inscription.
     */
    authWelcome: (userData, clientUrl) => {
        const content = `
            <h2>👋 Bienvenue sur ECOM-WATCH !</h2>
            <p>Bonjour ${userData.firstName || userData.name || ''},</p>
            <p>Votre compte a bien été créé. Vous pouvez dès maintenant découvrir notre collection.</p>
            <p>Profitez de votre première visite pour explorer nos montres et accessoires premium.</p>
            <a href="${clientUrl}/shop" class="button">Découvrir la boutique</a>
        `;
        return {
            subject: 'Bienvenue sur ECOM-WATCH !',
            html: getBaseTemplate(content, 'Bienvenue'),
        };
    },

    /**
     * Lien de réinitialisation du mot de passe.
     * Le token a une durée de vie limitée — précisé dans l'email pour éviter
     * la confusion si l'utilisateur revient plus tard.
     */
    authPasswordReset: (resetUrl) => {
        const content = `
            <h2>🔒 Réinitialisation de votre mot de passe</h2>
            <p>Bonjour,</p>
            <p>Vous avez demandé la réinitialisation de votre mot de passe. Cliquez sur le bouton ci-dessous pour en définir un nouveau.</p>
            <p><strong>Ce lien est valable 1 heure.</strong> Passé ce délai, vous devrez effectuer une nouvelle demande.</p>
            <a href="${resetUrl}" class="button">Réinitialiser mon mot de passe</a>
            <p style="color: #999999; font-size: 13px; margin-top: 30px;">
                Si vous n'êtes pas à l'origine de cette demande, ignorez cet email — votre mot de passe ne sera pas modifié.
            </p>
        `;
        return {
            subject: 'Réinitialisation de votre mot de passe ECOM-WATCH',
            html: getBaseTemplate(content, 'Réinitialisation du mot de passe'),
        };
    },
};
