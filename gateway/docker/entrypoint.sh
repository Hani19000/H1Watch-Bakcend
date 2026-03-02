#!/bin/sh
set -e

echo "ECOM-WATCH Gateway démarrage..."
echo "PORT                  = ${PORT}"
echo "AUTH_SERVICE          = ${AUTH_SERVICE_HOST}"
echo "ORDER_SERVICE         = ${ORDER_SERVICE_HOST}"
echo "PRODUCT_SERVICE       = ${PRODUCT_SERVICE_HOST}"
echo "PAYMENT_SERVICE       = ${PAYMENT_SERVICE_HOST}"
echo "CART_SERVICE          = ${CART_SERVICE_HOST}"
echo "ADMIN_SERVICE         = ${ADMIN_SERVICE_HOST}"
echo "NOTIFICATION_SERVICE  = ${NOTIFICATION_SERVICE_HOST}"
echo "FRONTEND              = ${FRONTEND_DOMAIN}"

mkdir -p /tmp/nginx/conf.d

# Injection des variables dans nginx.conf.
# ADMIN_SERVICE_HOST est requis pour l'upstream admin_service déclaré dans nginx.conf.
# Son absence laisserait la chaîne littérale "${ADMIN_SERVICE_HOST}" dans la conf,
# empêchant nginx de résoudre l'upstream et rendant toutes les routes /api/v1/admin/* injoignables.
envsubst '${PORT} ${MONOLITH_URL} ${AUTH_SERVICE_HOST} ${ORDER_SERVICE_HOST} ${PRODUCT_SERVICE_HOST} ${PAYMENT_SERVICE_HOST} ${CART_SERVICE_HOST} ${ADMIN_SERVICE_HOST} ${NOTIFICATION_SERVICE_HOST} ${FRONTEND_DOMAIN}' \
  < /etc/nginx/nginx.conf > /tmp/nginx/nginx.conf

# Injection des variables dans default.conf.
# Même liste que nginx.conf : proxy_ssl_name et proxy_set_header Host utilisent
# ${ADMIN_SERVICE_HOST} dans le location block /api/v1/admin/*.
envsubst '${PORT} ${MONOLITH_URL} ${AUTH_SERVICE_HOST} ${ORDER_SERVICE_HOST} ${PRODUCT_SERVICE_HOST} ${PAYMENT_SERVICE_HOST} ${CART_SERVICE_HOST} ${ADMIN_SERVICE_HOST} ${NOTIFICATION_SERVICE_HOST} ${FRONTEND_DOMAIN}' \
  < /etc/nginx/conf.d/default.conf > /tmp/nginx/conf.d/default.conf

cp /etc/nginx/conf.d/proxy_params.conf /tmp/nginx/conf.d/proxy_params.conf

echo "Validation config..."
nginx -t -c /tmp/nginx/nginx.conf

echo "Gateway prêt sur :${PORT}"
exec nginx -g "daemon off;" -c /tmp/nginx/nginx.conf