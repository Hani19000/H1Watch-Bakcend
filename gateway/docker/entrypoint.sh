#!/bin/sh
set -e

echo "ECOM-WATCH Gateway démarrage..."
echo "PORT             = ${PORT}"
echo "AUTH_SERVICE     = ${AUTH_SERVICE_HOST}"
echo "ORDER_SERVICE    = ${ORDER_SERVICE_HOST}"
echo "PRODUCT_SERVICE  = ${PRODUCT_SERVICE_HOST}"
echo "PAYMENT_SERVICE  = ${PAYMENT_SERVICE_HOST}"
echo "CART_SERVICE     = ${CART_SERVICE_HOST}"
echo "FRONTEND         = ${FRONTEND_DOMAIN}"

mkdir -p /tmp/nginx/conf.d

# Injection des variables d'environnement dans les configs nginx.
# MONOLITH supprimé de la liste : plus aucune référence dans les templates.
envsubst '${PORT} ${AUTH_SERVICE_HOST} ${ORDER_SERVICE_HOST} ${PRODUCT_SERVICE_HOST} ${PAYMENT_SERVICE_HOST} ${CART_SERVICE_HOST} ${FRONTEND_DOMAIN}' \
  < /etc/nginx/nginx.conf > /tmp/nginx/nginx.conf

envsubst '${PORT} ${AUTH_SERVICE_HOST} ${ORDER_SERVICE_HOST} ${PRODUCT_SERVICE_HOST} ${PAYMENT_SERVICE_HOST} ${CART_SERVICE_HOST} ${FRONTEND_DOMAIN}' \
  < /etc/nginx/conf.d/default.conf > /tmp/nginx/conf.d/default.conf

cp /etc/nginx/conf.d/proxy_params.conf /tmp/nginx/conf.d/proxy_params.conf

echo "Validation de la configuration nginx..."
nginx -t -c /tmp/nginx/nginx.conf

echo "Gateway prêt sur :${PORT}"
exec nginx -g "daemon off;" -c /tmp/nginx/nginx.conf