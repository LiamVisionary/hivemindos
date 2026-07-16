# Native document-reader runtime fixtures

These compatibility fixtures are decoded only by `scripts/test-markitdown-sidecar-runtime.mjs` and are not included in the Tauri application bundle. Microsoft MarkItDown is the provenance of two test vectors, not a bundled runtime dependency.

- `upstream-test.xls.base64` is `packages/markitdown/tests/test_files/test.xls` from Microsoft MarkItDown commit `e144e0a2be95b34df17433bac904e635f2c5e551` (MIT), decoded SHA-256 `17a94b6514e8998f4dc25bc77265b6f62982c18614ba4401a87fa01f90f53f1d`.
- `upstream-test.msg.base64` is `packages/markitdown/tests/test_files/test_outlook_msg.msg` from the same commit, decoded SHA-256 `028d84ffe67e1865009669d13d4c12682943b32eccf7f84a8da1899db63b0131`.
- `slim-fixture.pptx.base64` is a minimal fixture generated with the pinned `python-pptx==1.0.2`, decoded SHA-256 `843921ead4808d60b6d285f319bab2eaf16cd3a59c6ee65515e0039457fa9f8e`.

The remaining format fixtures are generated in memory by the runtime test so they remain small and reviewable.
