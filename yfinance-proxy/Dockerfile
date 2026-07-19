# Internal-only Yahoo Finance proxy. See app.py for why this exists
# (Yahoo TLS-fingerprints its quote APIs; yfinance's curl_cffi passes).
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py ./

USER nobody

# The container filesystem is read-only; point yfinance's cache at tmpfs.
ENV HOME=/tmp

EXPOSE 8321

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8321/health', timeout=4)"]

CMD ["python", "app.py"]
