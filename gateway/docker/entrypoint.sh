#!/bin/sh
set -e

echo "ECOM-WATCH Gateway démarrage..."
echo "PORT             = ${PORT}"
echo "AUTH_SERVICE     = ${AUTH_SERVICE_HOST}"
echo "ORDER_SERVICE    = ${ORDER_SERVICE_HOST}"
echo "PRODUCT_SERVICE  = ${PRODUCT_SERVICE_HOST}"
echo "PAYMENT_SERVICE  = ${PAYMENT_SERVICE_HOST}"
echo "CART_SERVICE     = ${CART_SERVICE_HOST}"
echo "ADMIN_SERVICE    = ${ADMIN_SERVICE_HOST}"
echo "FRONTEND         = ${FRONTEND_DOMAIN}"

mkdir -p /tmp/nginx/conf.d

# Injection de toutes les variables dans les configs nginx.
envsubst '${PORT} ${AUTH_SERVICE_HOST} ${ORDER_SERVICE_HOST} ${PRODUCT_SERVICE_HOST} ${PAYMENT_SERVICE_HOST} ${CART_SERVICE_HOST} ${ADMIN_SERVICE_HOST} ${FRONTEND_DOMAIN}' \
  < /etc/nginx/nginx.conf > /tmp/nginx/nginx.conf

envsubst '${PORT} ${AUTH_SERVICE_HOST} ${ORDER_SERVICE_HOST} ${PRODUCT_SERVICE_HOST} ${PAYMENT_SERVICE_HOST} ${CART_SERVICE_HOST} ${ADMIN_SERVICE_HOST} ${FRONTEND_DOMAIN}' \
  < /etc/nginx/conf.d/default.conf > /tmp/nginx/conf.d/default.conf

cp /etc/nginx/conf.d/proxy_params.conf /tmp/nginx/conf.d/proxy_params.conf

echo "Validation de la configuration nginx..."
nginx -t -c /tmp/nginx/nginx.conf

echo "Gateway prêt sur :${PORT}"
exec nginx -g "daemon off;" -c /tmp/nginx/nginx.conf
```

---

## Variable d'environnement à ajouter dans Render

Sur le **service Gateway** (Render Dashboard → gateway → Environment) :
```
ADMIN_SERVICE_HOST = <l'hostname Render de ton admin-service>
                     ex: ecom-watch-admin.onrender.com
```

Sur l'**admin-service** (Render Dashboard → admin → Environment), les variables requises par `environment.js` :
```
PORT                  = 3008
JWT_ACCESS_SECRET     = <même valeur que les autres services>
REDIS_URL             = <ton Upstash Redis URL>
AUTH_SERVICE_URL      = https://ecom-watch-auth.onrender.com
ORDER_SERVICE_URL     = https://ecom-watch-order.onrender.com
PRODUCT_SERVICE_URL   = https://ecom-watch-product.onrender.com
INTERNAL_ADMIN_SECRET = <valeur secrète partagée avec product-service>
```

Sur le **product-service** (déjà requis par son `environment.js`) :
```
INTERNAL_ADMIN_SECRET = <même valeur que ci-dessus>