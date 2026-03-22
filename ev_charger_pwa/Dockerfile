ARG BUILD_FROM
FROM $BUILD_FROM

RUN apk add --no-cache python3 py3-pip gcc musl-dev python3-dev

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir --break-system-packages -r requirements.txt

COPY main.py .
COPY pwa/ ./pwa/
COPY rootfs/ /

RUN chmod +x /usr/bin/ev_charger.sh

CMD ["/usr/bin/ev_charger.sh"]
