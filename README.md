# Blakemark

A simple, low-data price desk for Bitcoin on Blake2b. Neoxa calls it XBT. NonKYC calls it BTCB2.

The big number is an equal-weight average of the live books on those two exchanges, converted to dollars. Best price is the cheapest of those trades. Stocks, other coins, funds, and major currencies sit beside it for comparison. The average can also be shown in other currencies, using the rate from each day.

No ads and no paywall.

## Android

The install file is on the [latest release](https://github.com/Kili109/blakemark/releases/latest).

Open it on the phone. If Android asks, allow install from the browser or files app.

## Run it on a computer

```bash
npm install
npm run dev
```

Open http://localhost:8080.

Port 8080 is the default, set in `package.json`. If that port is already in use, change it there and open the port you chose.
