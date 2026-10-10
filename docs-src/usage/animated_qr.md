# <a href="/">Documents</a> › [Usage Examples](../usage/usage_index.md) › **Animated QR Codes**

# Animated QR codes

A token too large for one QR code can be sent as an animated QR code using the NUT-16 binary fountain encoding. The sender loops over frames, and the receiver can start scanning at any point: it reassembles the token from any sufficient set of frames, so missed frames cost a little time rather than a restart.

If the token string fits one QR code, show it as a static QR code instead. Every wallet can read a text token, but only wallets that implement this encoding can read the frames.

## Sending

`FountainEncoder.forToken` accepts a `cashuB` string or a `Token`. Each frame is Base45 text: show it as one QR code exactly as returned, with no prefix.

```ts
import { FountainEncoder } from '@cashu/cashu-ts';

const encoder = FountainEncoder.forToken(tokenString, { fragmentSize: 183 });
const timer = setInterval(() => showQr(encoder.nextFrame()), 100); // `showQr` is your app's renderer
// clearInterval(timer) when the user closes the dialog
```

Frames use only the 45 characters of QR alphanumeric mode, so most QR libraries pick that mode automatically; if yours takes a mode option, choose alphanumeric, as a single segment with no ECI header.

Each frame is `fragmentSize + 24` bytes, encoded as 1.5 characters per byte. The default, 183, makes a 311-character frame that fills a version 10 QR code at error-correction level M exactly. A larger size means fewer frames but denser codes that are harder to scan from a phone screen; keep it within the QR library's alphanumeric capacity for the version and error-correction level you choose. The encoder keeps producing new frames for as long as you call it, so there is no need to cycle back to the first one. Nothing tells the sender when the receiver has finished, so let the user stop the animation.

`cashuA` tokens cannot be sent this way: NUT-16 carries V4 tokens only.

## Receiving

Any scanner that returns the QR code's text works, including the browser `BarcodeDetector` API (`rawValue`). Pass the text exactly as scanned: frames contain spaces, so do not trim it or change its case.

```ts
import { FountainDecoder, getTokenMetadata, Wallet } from '@cashu/cashu-ts';

const decoder = new FountainDecoder();

// Your camera loop callback
onQrScanned((text) => {
  if (!FountainDecoder.isFrame(text)) {
    return; // Not a fountain frame: hand it to your token or UR parser instead
  }
  let added: boolean;
  try {
    added = decoder.receive(text);
  } catch {
    return; // A corrupt or unrelated frame; keep scanning
  }
  render(decoder.progress); // `render` is your app's progress bar callback
  if (added && decoder.isComplete) {
    claim(decoder.result!).catch(render);
  }
});

async function claim(binaryToken: Uint8Array) {
  const meta = getTokenMetadata(binaryToken);
  // Validate meta.mint against your trusted-mint policy before any network call
  const wallet = new Wallet(meta.mint, { unit: meta.unit });
  await wallet.loadMint();
  return wallet.decodeToken(binaryToken);
}
```

`receive` returns true only for frames that add information, so `added && decoder.isComplete` is true exactly once, on the frame that completes the transfer. Later frames return false; stop the scanner there.

The result is the token's raw binary form (`craw` + `B` + CBOR). `getTokenMetadata` and `wallet.decodeToken` both accept it, the same as a token string, and validate it. A completed transfer only means the bytes arrived intact: the token is untrusted input like any other, and an empty or malformed message makes `claim` throw.

## When `receive` throws

`receive` throws a `CTSError` for a frame it cannot use: corrupt, from an unsupported format version, or from a different transfer. Usually you keep scanning. Never pass text that `isFrame` accepted to your token parser instead, even after a throw: NUT-16 forbids that fallback. For an unsupported version, tell the user the format is not supported. To switch to a new transfer, for example when the sender restarts with another token, call `decoder.reset()` first.

If the frames reassemble into a message that fails its checksum, `receive` throws and the decoder resets itself, so the next frames start the transfer again.
