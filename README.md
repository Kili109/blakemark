# Blakemark

A price desk for **Bitcoin on Blake2b**. Neoxa calls it XBT. NonKYC calls it BTCB2.

The headline is an equal-weight average of the live books on those two exchanges, in BTC, USDT, and USDC, converted to dollars. Best price is the cheapest of those same trades. Tech stocks, other coins, funds, and major currencies sit beside it for comparison.

## Run it on a computer

```bash
npm install
npm run dev
```

Open http://localhost:8080.

## Phone

The Android app is a separate install file. It is not stored in this repository. Install that file on the phone, then allow installs from your browser or files app if Android asks.

## Do not publish

`android/release.keystore` signs the Android app. Keep it private. If it is lost, updates will not install over the existing app.
