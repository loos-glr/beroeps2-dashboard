# Lokale nabootsing van de Plesk-productieomgeving: PHP 8.3 + Apache 2.4 met .htaccess
FROM php:8.3-apache

RUN docker-php-ext-install pdo_mysql opcache \
    && a2enmod rewrite headers \
    # curl en mbstring zitten in de basisimage; falen bouwen als ze ontbreken
    && php -r 'foreach (["curl","mbstring","pdo_mysql","Zend OPcache"] as $e) { if (!extension_loaded($e)) { fwrite(STDERR, "ontbreekt: $e\n"); exit(1); } }'

ENV APACHE_DOCUMENT_ROOT=/var/www/html/public

RUN sed -ri -e 's!/var/www/html!${APACHE_DOCUMENT_ROOT}!g' \
        /etc/apache2/sites-available/000-default.conf \
        /etc/apache2/sites-available/default-ssl.conf \
    && printf '<Directory ${APACHE_DOCUMENT_ROOT}>\n    AllowOverride All\n    Require all granted\n</Directory>\n' \
        > /etc/apache2/conf-available/docroot.conf \
    && a2enconf docroot
