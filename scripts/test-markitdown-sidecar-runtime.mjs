#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { deflateRawSync } from "node:zlib";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const root = await mkdtemp(join(tmpdir(), "hivemind-markitdown-runtime-"));
const binary = resolve("src-tauri", "binaries", stagedBinaryName());
const {
  convertWithMarkItDownSidecar,
  shutdownMarkItDownSidecar,
  warmMarkItDownSidecar,
} = await import("../src/lib/services/markitdown-sidecar-client.ts");
const sidecar = {
  binaries: [binary],
  expectedVersion: "hivemind-docs-1",
  environment: process.env,
};

try {
  await warmMarkItDownSidecar(sidecar.binaries, sidecar.expectedVersion, sidecar.environment);

  const textPath = join(root, "brief.txt");
  await writeFile(textPath, "Quarterly revenue grew 42%.", "utf8");
  const converted = await request(textPath);
  assert.equal(converted.converterVersion, "hivemind-docs-1");
  assert.match(converted.markdown, /Quarterly revenue grew 42%/);

  await verifyFormatMatrix();

  const safeArchivePath = join(root, "safe.zip");
  await writeFile(safeArchivePath, zipWithEntry("notes.txt", Buffer.from("Safe archive knowledge.")));
  const safeArchive = await request(safeArchivePath);
  assert.match(safeArchive.markdown, /Safe archive knowledge/);

  await assertRejected("https://example.com/report.pdf", /local document path/i);

  const executablePath = join(root, "payload.exe");
  await writeFile(executablePath, "not executable", "utf8");
  await assertRejected(executablePath, /unsupported document extension/i);

  const traversalPath = join(root, "traversal.zip");
  await writeFile(traversalPath, zipWithEntry("../escape.txt", Buffer.from("escape")));
  await assertRejected(traversalPath, /unsafe path/i);

  const drivePath = join(root, "drive-path.zip");
  await writeFile(drivePath, zipWithEntry("C:/escape.txt", Buffer.from("escape")));
  await assertRejected(drivePath, /unsafe path/i);

  const nestedPath = join(root, "nested.zip");
  await writeFile(nestedPath, zipWithEntry("inside.zip", Buffer.from("nested")));
  await assertRejected(nestedPath, /nested zip archives/i);

  const executableArchivePath = join(root, "executable.zip");
  await writeFile(executableArchivePath, zipWithEntry("payload.exe", Buffer.from("binary")));
  await assertRejected(executableArchivePath, /unsupported document extension/i);

  const linkArchivePath = join(root, "link.zip");
  await writeFile(linkArchivePath, zipWithEntry("link.txt", Buffer.from("target"), false, 0o120777 * 0x10000));
  await assertRejected(linkArchivePath, /unsupported link entry/i);

  const bombPath = join(root, "bomb.zip");
  await writeFile(bombPath, zipWithEntry("zeros.txt", Buffer.alloc(1024 * 1024), true));
  await assertRejected(bombPath, /compression ratio/i);

  console.log("MarkItDown sidecar warm-runtime safety test passed");
} finally {
  shutdownMarkItDownSidecar();
  await rm(root, { recursive: true, force: true });
}

async function request(path) {
  return convertWithMarkItDownSidecar({ ...sidecar, filePath: path, timeoutMs: 45_000 });
}

async function assertRejected(path, pattern) {
  await assert.rejects(request(path), pattern);
}

async function verifyFormatMatrix() {
  const cases = [
    ["knowledge.md", "# Markdown document knowledge", /Markdown document knowledge/],
    ["knowledge.markdown", "# Long Markdown extension", /Long Markdown extension/],
    ["knowledge.csv", "metric,value\nrevenue,42", /\| metric \| value \|[\s\S]*\| revenue \| 42 \|/],
    ["knowledge.json", '{"source":"JSON document knowledge"}', /JSON document knowledge/],
    ["knowledge.xml", "<knowledge>XML document knowledge</knowledge>", /XML document knowledge/],
    ["knowledge.html", "<html><body><h1>HTML document knowledge</h1></body></html>", /# HTML document knowledge/],
    ["knowledge.htm", "<html><body><p>HTM document knowledge</p></body></html>", /HTM document knowledge/],
    ["knowledge.docx", docxFixture(), /DOCX document knowledge/],
    ["knowledge.pptx", await base64Fixture("slim-fixture.pptx.base64"), /Bundled presentation knowledge/],
    ["knowledge.xlsx", xlsxFixture(), /Spreadsheet document knowledge/],
    ["knowledge.xls", await base64Fixture("upstream-test.xls.base64"), /6ff4173b-42a5-4784-9b19-f49caff4d93d/],
    ["knowledge.epub", epubFixture(), /EPUB document knowledge/],
    ["knowledge.msg", await base64Fixture("upstream-test.msg.base64"), /This is the body of the test email message/],
    ["knowledge.pdf", pdfFixture("PDF document knowledge"), /PDF document knowledge/],
  ];

  for (const [name, contents, expected] of cases) {
    const path = join(root, name);
    await writeFile(path, contents);
    const converted = await request(path);
    assert.match(converted.markdown, expected, `${name} should preserve representative document content`);
  }
}

async function base64Fixture(name) {
  const encoded = await readFile(resolve("scripts", "fixtures", "markitdown", name), "utf8");
  return Buffer.from(encoded.replace(/\s/g, ""), "base64");
}

function stagedBinaryName() {
  if (process.platform === "darwin" && process.arch === "arm64") return "hivemind-markitdown-aarch64-apple-darwin";
  if (process.platform === "darwin" && process.arch === "x64") return "hivemind-markitdown-x86_64-apple-darwin";
  if (process.platform === "linux" && process.arch === "x64") return "hivemind-markitdown-x86_64-unknown-linux-gnu";
  if (process.platform === "win32" && process.arch === "x64") return "hivemind-markitdown-x86_64-pc-windows-msvc.exe";
  throw new Error(`Unsupported sidecar test platform: ${process.platform}/${process.arch}`);
}

function zipWithEntry(name, contents, deflate = false, externalAttributes = 0) {
  return zipWithEntries([{ name, contents, deflate, externalAttributes }]);
}

function zipWithEntries(entries) {
  const localRecords = [];
  const centralRecords = [];
  let localOffset = 0;

  for (const { name, contents, deflate = false, externalAttributes = 0 } of entries) {
    const body = Buffer.isBuffer(contents) ? contents : Buffer.from(contents, "utf8");
    const fileName = Buffer.from(name, "utf8");
    const compressed = deflate ? deflateRawSync(body) : body;
    const method = deflate ? 8 : 0;
    const crc = crc32(body);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(body.length, 22);
    localHeader.writeUInt16LE(fileName.length, 26);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    const versionMadeBy = externalAttributes ? (3 << 8) | 20 : 20;
    centralHeader.writeUInt16LE(versionMadeBy, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(body.length, 24);
    centralHeader.writeUInt16LE(fileName.length, 28);
    centralHeader.writeUInt32LE(externalAttributes >>> 0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);

    const local = Buffer.concat([localHeader, fileName, compressed]);
    localRecords.push(local);
    centralRecords.push(Buffer.concat([centralHeader, fileName]));
    localOffset += local.length;
  }

  const local = Buffer.concat(localRecords);
  const central = Buffer.concat(centralRecords);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, central, end]);
}

function docxFixture() {
  return zipWithEntries([
    {
      name: "[Content_Types].xml",
      contents: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    },
    {
      name: "_rels/.rels",
      contents: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    },
    {
      name: "word/document.xml",
      contents: '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>DOCX document knowledge</w:t></w:r></w:p><w:sectPr/></w:body></w:document>',
    },
  ]);
}

function xlsxFixture() {
  return zipWithEntries([
    {
      name: "[Content_Types].xml",
      contents: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    },
    {
      name: "_rels/.rels",
      contents: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    },
    {
      name: "xl/workbook.xml",
      contents: '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Knowledge" sheetId="1" r:id="rId1"/></sheets></workbook>',
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      contents: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    },
    {
      name: "xl/worksheets/sheet1.xml",
      contents: '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Topic</t></is></c><c r="B1" t="inlineStr"><is><t>Value</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Spreadsheet document knowledge</t></is></c><c r="B2"><v>42</v></c></row></sheetData></worksheet>',
    },
  ]);
}

function epubFixture() {
  return zipWithEntries([
    { name: "mimetype", contents: "application/epub+zip" },
    {
      name: "META-INF/container.xml",
      contents: '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    },
    {
      name: "OEBPS/content.opf",
      contents: '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0"><metadata><dc:title>Slim EPUB</dc:title><dc:creator>HivemindOS</dc:creator></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>',
    },
    {
      name: "OEBPS/chapter.xhtml",
      contents: '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>EPUB document knowledge</h1></body></html>',
    },
  ]);
}

function pdfFixture(text) {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "ascii");
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
