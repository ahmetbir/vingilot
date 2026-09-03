import assert from "node:assert/strict";
import { test } from "node:test";

import { osc52Text } from "./osc52.ts";

test("the clipboard selection with base64 text decodes to the text", () => {
  assert.equal(osc52Text("c;SGVsbG8="), "Hello");
});

test("an empty selection list still names the clipboard", () => {
  assert.equal(osc52Text(";SGVsbG8="), "Hello");
});

test("what tmux sends: selection then payload, UTF-8 inside", () => {
  // "merhaba dünya" as tmux would announce a copied line.
  assert.equal(osc52Text("c;bWVyaGFiYSBkw7xueWE="), "merhaba dünya");
});

test("a read request is refused, not answered", () => {
  // `?` asks the terminal to send the clipboard back to the program. That is
  // the last thing copied — possibly a secret — handed to any pane.
  assert.equal(osc52Text("c;?"), null);
  assert.equal(osc52Text("?"), null);
});

test("no data, or data that is not base64, is nothing", () => {
  assert.equal(osc52Text("c;"), null);
  assert.equal(osc52Text(""), null);
  assert.equal(osc52Text("c;not base64!"), null);
});

test("bytes that are not UTF-8 are refused rather than mangled", () => {
  // 0xff 0xfe is not a UTF-8 sequence.
  assert.equal(osc52Text("c;//4="), null);
});
