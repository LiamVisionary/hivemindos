use calamine::{Reader as CalamineReader, open_workbook_auto_from_rs};
use html_to_markdown_rs::{ConversionOptions, convert as html_to_markdown};
use lopdf::Document;
use msg_parser::Outlook;
use quick_xml::Reader as XmlReader;
use quick_xml::escape::unescape;
use quick_xml::events::Event;
use serde_json::{Value, json};
use std::env;
use std::fs;
use std::io::{self, BufRead, BufWriter, Cursor, Read, Write};
use std::path::{Path, PathBuf};
use zip::ZipArchive;

const CONVERTER_VERSION: &str = "hivemind-docs-1";
const MAX_INPUT_BYTES: u64 = 64 * 1024 * 1024;
const MAX_ZIP_ENTRIES: usize = 200;
const MAX_PACKAGE_ENTRIES: usize = 5_000;
const MAX_ZIP_ENTRY_BYTES: u64 = 64 * 1024 * 1024;
const MAX_ZIP_EXPANDED_BYTES: u64 = 128 * 1024 * 1024;
const MAX_PACKAGE_EXPANDED_BYTES: u64 = 256 * 1024 * 1024;
const MAX_ZIP_COMPRESSION_RATIO: u64 = 100;
const MAX_PACKAGE_COMPRESSION_RATIO: u64 = 500;
const MAX_OUTPUT_CHARS: usize = 1_000_000;

const ALLOWED_EXTENSIONS: &[&str] = &[
    "md", "markdown", "txt", "csv", "json", "xml", "html", "htm", "pdf", "docx",
    "pptx", "xlsx", "xls", "epub", "msg", "zip",
];

fn main() {
    let code = match env::args().skip(1).collect::<Vec<_>>().as_slice() {
        [flag] if flag == "--version" => print_version(),
        [flag] if flag == "--stdio" => serve_stdio(),
        [path] => convert_command(path),
        _ => {
            eprintln!("Usage: hivemind-markitdown <local-document-path>");
            2
        }
    };
    std::process::exit(code);
}

fn print_version() -> i32 {
    println!(
        "{}",
        json!({ "ok": true, "converterVersion": CONVERTER_VERSION })
    );
    0
}

fn serve_stdio() -> i32 {
    let stdin = io::stdin();
    let mut output = BufWriter::new(io::stdout().lock());
    if write_json_line(
        &mut output,
        &json!({
            "type": "ready",
            "ok": true,
            "converterVersion": CONVERTER_VERSION,
        }),
    )
    .is_err()
    {
        return 1;
    }

    for line in stdin.lock().lines() {
        let response = match line {
            Ok(line) => protocol_response(&line),
            Err(error) => json!({ "id": Value::Null, "ok": false, "error": error.to_string() }),
        };
        let shutdown = response.get("shutdown").and_then(Value::as_bool) == Some(true);
        if write_json_line(&mut output, &response).is_err() {
            return 1;
        }
        if shutdown {
            return 0;
        }
    }
    0
}

fn protocol_response(line: &str) -> Value {
    let request = match serde_json::from_str::<Value>(line) {
        Ok(Value::Object(request)) => request,
        Ok(_) => return error_response(Value::Null, "A JSON object request is required."),
        Err(error) => return error_response(Value::Null, &format!("Invalid request JSON: {error}")),
    };
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    let Some(id_text) = id.as_str().filter(|value| !value.is_empty()) else {
        return error_response(id, "A non-empty request id is required.");
    };
    if request.get("action").and_then(Value::as_str) == Some("shutdown") {
        return json!({ "id": id_text, "ok": true, "shutdown": true });
    }
    let Some(path) = request.get("path").and_then(Value::as_str) else {
        return error_response(id, "A local document path is required.");
    };
    match convert_path(path) {
        Ok(markdown) => json!({
            "id": id_text,
            "ok": true,
            "converterVersion": CONVERTER_VERSION,
            "markdown": markdown,
            "warnings": [],
        }),
        Err(error) => error_response(id, &error),
    }
}

fn error_response(id: Value, error: &str) -> Value {
    json!({
        "id": id,
        "ok": false,
        "converterVersion": CONVERTER_VERSION,
        "error": error,
    })
}

fn write_json_line(output: &mut impl Write, value: &Value) -> io::Result<()> {
    serde_json::to_writer(&mut *output, value)?;
    output.write_all(b"\n")?;
    output.flush()
}

fn convert_command(raw_path: &str) -> i32 {
    match convert_path(raw_path) {
        Ok(markdown) => {
            println!(
                "{}",
                json!({
                    "ok": true,
                    "converterVersion": CONVERTER_VERSION,
                    "markdown": markdown,
                    "warnings": [],
                })
            );
            0
        }
        Err(error) => {
            eprintln!("HivemindOS document reader: {error}");
            2
        }
    }
}

fn convert_path(raw_path: &str) -> Result<String, String> {
    if raw_path.trim().is_empty() || raw_path.contains("://") {
        return Err("A local document path is required.".to_string());
    }
    let requested = expand_home(raw_path)?;
    let initial = fs::symlink_metadata(&requested)
        .map_err(|error| format!("The selected document could not be read: {error}"))?;
    if initial.file_type().is_symlink() || !initial.is_file() {
        return Err("The selected document is not a regular file.".to_string());
    }
    if initial.len() == 0 {
        return Err("The selected document is empty.".to_string());
    }
    if initial.len() > MAX_INPUT_BYTES {
        return Err("The selected document exceeds the 64 MB limit.".to_string());
    }
    let path = fs::canonicalize(&requested)
        .map_err(|error| format!("The selected document could not be resolved: {error}"))?;
    let extension = extension_of(&path)?;
    let bytes = fs::read(&path)
        .map_err(|error| format!("The selected document could not be read: {error}"))?;
    let markdown = convert_bytes(&extension, &bytes)?;
    normalize_output(markdown)
}

fn expand_home(raw_path: &str) -> Result<PathBuf, String> {
    if raw_path == "~" || raw_path.starts_with("~/") || raw_path.starts_with("~\\") {
        let home = env::var_os("HOME")
            .or_else(|| env::var_os("USERPROFILE"))
            .ok_or_else(|| "The current user's home directory is unavailable.".to_string())?;
        let suffix = raw_path
            .strip_prefix("~/")
            .or_else(|| raw_path.strip_prefix("~\\"))
            .unwrap_or("");
        return Ok(PathBuf::from(home).join(suffix));
    }
    Ok(PathBuf::from(raw_path))
}

fn extension_of(path: &Path) -> Result<String, String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !ALLOWED_EXTENSIONS.contains(&extension.as_str()) {
        return Err(format!(
            "Unsupported document extension: {}.",
            if extension.is_empty() { "(none)" } else { &extension }
        ));
    }
    Ok(extension)
}

fn convert_bytes(extension: &str, bytes: &[u8]) -> Result<String, String> {
    match extension {
        "md" | "markdown" | "txt" => decode_text(bytes),
        "xml" => Ok(format!("```xml\n{}\n```", decode_text(bytes)?)),
        "json" => convert_json(bytes),
        "html" | "htm" => convert_html(bytes),
        "csv" => convert_csv(bytes),
        "docx" => {
            validate_package(bytes)?;
            convert_docx(bytes)
        }
        "pptx" => {
            validate_package(bytes)?;
            convert_pptx(bytes)
        }
        "xlsx" => {
            validate_package(bytes)?;
            convert_spreadsheet(bytes)
        }
        "pdf" => convert_pdf(bytes),
        "xls" => convert_spreadsheet(bytes),
        "epub" => convert_epub(bytes),
        "msg" => convert_message(bytes),
        "zip" => convert_document_archive(bytes),
        _ => Err(format!("Unsupported document extension: {extension}.")),
    }
}

fn normalize_output(markdown: String) -> Result<String, String> {
    let normalized = markdown.replace("\r\n", "\n").replace('\r', "\n");
    let trimmed = normalized.trim();
    if trimmed.is_empty() {
        return Err("The document reader did not extract any document content.".to_string());
    }
    if trimmed.chars().count() > MAX_OUTPUT_CHARS {
        return Err("Extracted document exceeds the 1,000,000 character limit.".to_string());
    }
    Ok(trimmed.to_string())
}

fn decode_text(bytes: &[u8]) -> Result<String, String> {
    if let Some(body) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8(body.to_vec()).map_err(|error| format!("Document is not valid UTF-8: {error}"));
    }
    if let Some(body) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        return decode_utf16(body, true);
    }
    if let Some(body) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        return decode_utf16(body, false);
    }
    String::from_utf8(bytes.to_vec()).map_err(|error| format!("Document is not valid UTF-8: {error}"))
}

fn decode_utf16(bytes: &[u8], little_endian: bool) -> Result<String, String> {
    if !bytes.len().is_multiple_of(2) {
        return Err("UTF-16 document has an incomplete code unit.".to_string());
    }
    let units = bytes.chunks_exact(2).map(|pair| {
        if little_endian {
            u16::from_le_bytes([pair[0], pair[1]])
        } else {
            u16::from_be_bytes([pair[0], pair[1]])
        }
    });
    char::decode_utf16(units)
        .collect::<Result<String, _>>()
        .map_err(|error| format!("Document contains invalid UTF-16: {error}"))
}

fn convert_json(bytes: &[u8]) -> Result<String, String> {
    let value: Value = serde_json::from_slice(bytes)
        .map_err(|error| format!("JSON conversion failed: {error}"))?;
    let pretty = serde_json::to_string_pretty(&value)
        .map_err(|error| format!("JSON conversion failed: {error}"))?;
    Ok(format!("```json\n{pretty}\n```"))
}

fn convert_html(bytes: &[u8]) -> Result<String, String> {
    let html = decode_text(bytes)?;
    convert_html_text(&html)
}

fn convert_html_text(html: &str) -> Result<String, String> {
    let result = html_to_markdown(html, None::<ConversionOptions>)
        .map_err(|error| format!("HTML conversion failed: {error}"))?;
    result
        .content
        .ok_or_else(|| "HTML conversion did not produce Markdown.".to_string())
}

fn convert_csv(bytes: &[u8]) -> Result<String, String> {
    let mut reader = csv::ReaderBuilder::new().flexible(true).from_reader(bytes);
    let mut rows = vec![reader
        .headers()
        .map_err(|error| format!("CSV conversion failed: {error}"))?
        .iter()
        .map(str::to_string)
        .collect::<Vec<_>>()];
    for record in reader.records() {
        rows.push(
            record
                .map_err(|error| format!("CSV conversion failed: {error}"))?
                .iter()
                .map(str::to_string)
                .collect(),
        );
    }
    Ok(render_table("CSV", &rows))
}

fn convert_docx(bytes: &[u8]) -> Result<String, String> {
    let document = read_named_archive_entry(bytes, "word/document.xml", "DOCX")?;
    extract_office_xml_text(&document, "DOCX")
}

fn convert_pptx(bytes: &[u8]) -> Result<String, String> {
    let mut archive = open_archive(bytes)?;
    let mut slides = Vec::new();
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|error| format!("PPTX entry could not be opened: {error}"))?;
        let name = entry.name().to_string();
        if let Some(number) = slide_number(&name) {
            slides.push((number, name));
        }
    }
    slides.sort_by_key(|(number, _)| *number);
    if slides.is_empty() {
        return Err("PPTX contains no readable slides.".to_string());
    }
    let mut sections = Vec::with_capacity(slides.len());
    for (number, name) in slides {
        let content = {
            let mut entry = archive
                .by_name(&name)
                .map_err(|error| format!("PPTX slide could not be opened: {error}"))?;
            read_bounded_entry(&mut entry)?
        };
        let text = extract_office_xml_text(&content, "PPTX")?;
        if !text.trim().is_empty() {
            sections.push(format!("## Slide {number}\n\n{text}"));
        }
    }
    if sections.is_empty() {
        return Err("PPTX contains no readable slide text.".to_string());
    }
    Ok(sections.join("\n\n"))
}

fn slide_number(name: &str) -> Option<u32> {
    let value = name.strip_prefix("ppt/slides/slide")?.strip_suffix(".xml")?;
    if value.contains('/') {
        return None;
    }
    value.parse().ok()
}

fn read_named_archive_entry(bytes: &[u8], name: &str, format: &str) -> Result<Vec<u8>, String> {
    let mut archive = open_archive(bytes)?;
    let mut entry = archive
        .by_name(name)
        .map_err(|error| format!("{format} is missing {name}: {error}"))?;
    read_bounded_entry(&mut entry)
}

fn extract_office_xml_text(xml: &[u8], format: &str) -> Result<String, String> {
    let mut reader = XmlReader::from_reader(xml);
    reader.config_mut().trim_text(false);
    let mut buffer = Vec::new();
    let mut output = String::new();
    let mut in_text = false;
    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(event)) => {
                in_text = local_name(event.name().as_ref()) == b"t";
            }
            Ok(Event::Empty(event)) => match local_name(event.name().as_ref()) {
                b"tab" => output.push('\t'),
                b"br" => push_line_break(&mut output),
                _ => {}
            },
            Ok(Event::Text(text)) if in_text => {
                let decoded = text
                    .decode()
                    .map_err(|error| format!("{format} text decode failed: {error}"))?;
                let decoded = unescape(&decoded)
                    .map_err(|error| format!("{format} XML entity decode failed: {error}"))?;
                output.push_str(&decoded);
            }
            Ok(Event::CData(text)) if in_text => {
                let decoded = text
                    .decode()
                    .map_err(|error| format!("{format} CDATA decode failed: {error}"))?;
                output.push_str(&decoded);
            }
            Ok(Event::End(event)) => match local_name(event.name().as_ref()) {
                b"t" => in_text = false,
                b"p" => push_line_break(&mut output),
                _ => {}
            },
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(error) => return Err(format!("{format} XML parsing failed: {error}")),
        }
        buffer.clear();
    }
    Ok(output.trim().to_string())
}

fn local_name(name: &[u8]) -> &[u8] {
    name.rsplit(|byte| *byte == b':').next().unwrap_or(name)
}

fn push_line_break(output: &mut String) {
    if !output.is_empty() && !output.ends_with('\n') {
        output.push('\n');
    }
}

fn convert_pdf(bytes: &[u8]) -> Result<String, String> {
    let document = Document::load_mem(bytes)
        .map_err(|error| format!("PDF conversion failed: {error}"))?;
    let page_numbers = document.get_pages().keys().copied().collect::<Vec<_>>();
    if page_numbers.is_empty() {
        return Err("PDF contains no readable pages.".to_string());
    }
    document
        .extract_text_with_limit(&page_numbers, MAX_OUTPUT_CHARS.saturating_mul(4))
        .map_err(|error| format!("PDF text extraction failed: {error}"))
}

fn convert_spreadsheet(bytes: &[u8]) -> Result<String, String> {
    let mut workbook = open_workbook_auto_from_rs(Cursor::new(bytes.to_vec()))
        .map_err(|error| format!("Spreadsheet conversion failed: {error}"))?;
    let sheet_names = workbook.sheet_names().to_vec();
    let mut sections = Vec::new();
    for name in sheet_names {
        let range = workbook
            .worksheet_range(&name)
            .map_err(|error| format!("Spreadsheet sheet {name} could not be read: {error}"))?;
        let rows = range
            .rows()
            .map(|row| row.iter().map(ToString::to_string).collect::<Vec<_>>())
            .collect::<Vec<_>>();
        sections.push(render_table(&name, &rows));
    }
    Ok(sections.join("\n\n"))
}

fn render_table(name: &str, rows: &[Vec<String>]) -> String {
    let nonempty = rows
        .iter()
        .filter(|row| row.iter().any(|cell| !cell.is_empty()))
        .collect::<Vec<_>>();
    if nonempty.is_empty() {
        return format!("## Sheet: {}", escape_cell(name));
    }
    let width = nonempty.iter().map(|row| row.len()).max().unwrap_or(1);
    let row_line = |row: &[String]| {
        let cells = (0..width)
            .map(|index| escape_cell(row.get(index).map_or("", String::as_str)))
            .collect::<Vec<_>>();
        format!("| {} |", cells.join(" | "))
    };
    let mut output = format!("## Sheet: {}\n\n{}\n| {} |", escape_cell(name), row_line(nonempty[0]), vec!["---"; width].join(" | "));
    for row in nonempty.iter().skip(1) {
        output.push('\n');
        output.push_str(&row_line(row));
    }
    output
}

fn escape_cell(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('|', "\\|")
        .replace("\r\n", "<br>")
        .replace(['\r', '\n'], "<br>")
}

fn convert_message(bytes: &[u8]) -> Result<String, String> {
    let message = Outlook::from_slice(bytes)
        .map_err(|error| format!("MSG conversion failed: {error}"))?;
    let mut output = String::new();
    if !message.subject.trim().is_empty() {
        output.push_str("# ");
        output.push_str(message.subject.trim());
        output.push_str("\n\n");
    }
    append_field(&mut output, "From", &message.sender.to_string());
    append_field(&mut output, "To", &join_people(&message.to));
    append_field(&mut output, "Cc", &join_people(&message.cc));
    append_field(&mut output, "Date", &message.message_delivery_time);
    if !output.ends_with("\n\n") {
        output.push('\n');
    }
    if !message.body.trim().is_empty() {
        output.push_str(message.body.trim());
    } else if !message.html.trim().is_empty() {
        output.push_str(convert_html_text(&message.html)?.trim());
    } else if let Some(html) = message.html_from_rtf() {
        output.push_str(convert_html_text(&html)?.trim());
    }
    if !message.attachments.is_empty() {
        output.push_str("\n\n## Attachments\n\n");
        for attachment in &message.attachments {
            output.push_str("- ");
            output.push_str(&attachment.to_string());
            output.push('\n');
        }
    }
    Ok(output)
}

fn append_field(output: &mut String, label: &str, value: &str) {
    if value.trim().is_empty() {
        return;
    }
    output.push_str("- **");
    output.push_str(label);
    output.push_str(":** ");
    output.push_str(value.trim());
    output.push('\n');
}

fn join_people(people: &[msg_parser::Person]) -> String {
    people
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join(", ")
}

fn convert_epub(bytes: &[u8]) -> Result<String, String> {
    validate_archive_limits(bytes, ArchiveLimits::package())?;
    let mut archive = open_archive(bytes)?;
    let mut chapters = Vec::new();
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("EPUB entry could not be opened: {error}"))?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().to_string();
        let extension = Path::new(&name)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if extension != "html" && extension != "htm" && extension != "xhtml" {
            continue;
        }
        let content = read_bounded_entry(&mut entry)?;
        chapters.push((name, convert_html(&content)?));
    }
    chapters.sort_by(|left, right| left.0.cmp(&right.0));
    if chapters.is_empty() {
        return Err("EPUB contains no readable HTML chapters.".to_string());
    }
    Ok(chapters
        .into_iter()
        .map(|(name, markdown)| format!("## {name}\n\n{markdown}"))
        .collect::<Vec<_>>()
        .join("\n\n"))
}

fn convert_document_archive(bytes: &[u8]) -> Result<String, String> {
    validate_archive_limits(bytes, ArchiveLimits::documents())?;
    let mut archive = open_archive(bytes)?;
    let mut documents = Vec::new();
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("ZIP entry could not be opened: {error}"))?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().to_string();
        let extension = Path::new(&name)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if extension == "zip" {
            return Err("Nested ZIP archives are not supported.".to_string());
        }
        if !ALLOWED_EXTENSIONS.contains(&extension.as_str()) {
            return Err(format!(
                "ZIP entry uses an unsupported document extension: {}.",
                if extension.is_empty() { "(none)" } else { &extension }
            ));
        }
        let content = read_bounded_entry(&mut entry)?;
        documents.push((name, convert_bytes(&extension, &content)?));
    }
    if documents.is_empty() {
        return Err("ZIP archive contains no supported documents.".to_string());
    }
    Ok(documents
        .into_iter()
        .map(|(name, markdown)| format!("## {name}\n\n{markdown}"))
        .collect::<Vec<_>>()
        .join("\n\n"))
}

fn validate_package(bytes: &[u8]) -> Result<(), String> {
    validate_archive_limits(bytes, ArchiveLimits::package())
}

#[derive(Clone, Copy)]
struct ArchiveLimits {
    max_entries: usize,
    max_expanded_bytes: u64,
    max_ratio: u64,
    documents_only: bool,
}

impl ArchiveLimits {
    const fn documents() -> Self {
        Self {
            max_entries: MAX_ZIP_ENTRIES,
            max_expanded_bytes: MAX_ZIP_EXPANDED_BYTES,
            max_ratio: MAX_ZIP_COMPRESSION_RATIO,
            documents_only: true,
        }
    }

    const fn package() -> Self {
        Self {
            max_entries: MAX_PACKAGE_ENTRIES,
            max_expanded_bytes: MAX_PACKAGE_EXPANDED_BYTES,
            max_ratio: MAX_PACKAGE_COMPRESSION_RATIO,
            documents_only: false,
        }
    }
}

fn validate_archive_limits(bytes: &[u8], limits: ArchiveLimits) -> Result<(), String> {
    let mut archive = open_archive(bytes)?;
    if archive.len() > limits.max_entries {
        return Err(format!(
            "ZIP archives may contain at most {} files.",
            limits.max_entries
        ));
    }
    let mut expanded = 0_u64;
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|error| format!("ZIP entry could not be inspected: {error}"))?;
        let name = entry.name();
        if !safe_archive_path(name) {
            return Err("ZIP archive contains an unsafe path.".to_string());
        }
        if entry.is_symlink() {
            return Err("ZIP archive contains an unsupported link entry.".to_string());
        }
        if entry.is_dir() {
            continue;
        }
        let size = entry.size();
        let compressed = entry.compressed_size().max(1);
        if size > MAX_ZIP_ENTRY_BYTES {
            return Err("A ZIP entry exceeds the 64 MB per-file limit.".to_string());
        }
        expanded = expanded.saturating_add(size);
        if expanded > limits.max_expanded_bytes {
            return Err("ZIP archive exceeds the expanded-size limit.".to_string());
        }
        if size > compressed.saturating_mul(limits.max_ratio) {
            return Err("ZIP archive exceeds the allowed compression ratio.".to_string());
        }
        if limits.documents_only {
            let extension = Path::new(name)
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if extension == "zip" {
                return Err("Nested ZIP archives are not supported.".to_string());
            }
            if !ALLOWED_EXTENSIONS.contains(&extension.as_str()) {
                return Err(format!(
                    "ZIP entry uses an unsupported document extension: {}.",
                    if extension.is_empty() { "(none)" } else { &extension }
                ));
            }
        }
    }
    Ok(())
}

fn safe_archive_path(name: &str) -> bool {
    if name.is_empty() || name.contains('\0') {
        return false;
    }
    let normalized = name.replace('\\', "/");
    if normalized.starts_with('/') {
        return false;
    }
    let mut parts = normalized.split('/');
    let first = parts.next().unwrap_or("");
    if first.ends_with(':') {
        return false;
    }
    !normalized.split('/').any(|part| part == "..")
}

fn open_archive(bytes: &[u8]) -> Result<ZipArchive<Cursor<&[u8]>>, String> {
    ZipArchive::new(Cursor::new(bytes)).map_err(|error| format!("Invalid ZIP archive: {error}"))
}

fn read_bounded_entry(entry: &mut impl Read) -> Result<Vec<u8>, String> {
    let mut content = Vec::new();
    entry
        .take(MAX_ZIP_ENTRY_BYTES + 1)
        .read_to_end(&mut content)
        .map_err(|error| format!("ZIP entry could not be read: {error}"))?;
    if content.len() as u64 > MAX_ZIP_ENTRY_BYTES {
        return Err("A ZIP entry exceeds the 64 MB per-file limit.".to_string());
    }
    Ok(content)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn archive_paths_reject_traversal_and_drive_prefixes() {
        assert!(!safe_archive_path("../escape.txt"));
        assert!(!safe_archive_path("C:/escape.txt"));
        assert!(!safe_archive_path("\\\\server\\escape.txt"));
        assert!(safe_archive_path("folder/notes.txt"));
    }

    #[test]
    fn table_cells_are_markdown_safe() {
        assert_eq!(escape_cell("a|b\nc"), "a\\|b<br>c");
    }
}
