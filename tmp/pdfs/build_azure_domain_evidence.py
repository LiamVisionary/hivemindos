from pathlib import Path

from PIL import Image
from reportlab.lib.pagesizes import landscape, letter
from reportlab.pdfgen import canvas


ROOT = Path("/Users/liam/Documents/code/projects/hivemind-os")
SOURCE_DIR = ROOT / "tmp" / "pdfs"
OUTPUT_PATH = ROOT / "output" / "pdf" / "azure-artifact-signing-hivemindos-domain-evidence.pdf"

SOURCE_IMAGES = [
    SOURCE_DIR / "namecheap-paid-domain-receipt.png",
    SOURCE_DIR / "namecheap-registrant-confirmation.png",
    SOURCE_DIR / "icann-hivemindos-app-rdap-viewport.png",
    SOURCE_DIR / "icann-hivemindos-app-registrar.png",
]


def draw_image_page(pdf: canvas.Canvas, image_path: Path) -> None:
    page_width, page_height = landscape(letter)
    margin = 18
    available_width = page_width - (2 * margin)
    available_height = page_height - (2 * margin)

    with Image.open(image_path) as image:
        image_width, image_height = image.size

    scale = min(available_width / image_width, available_height / image_height)
    rendered_width = image_width * scale
    rendered_height = image_height * scale
    x = (page_width - rendered_width) / 2
    y = (page_height - rendered_height) / 2

    pdf.setFillColorRGB(1, 1, 1)
    pdf.rect(0, 0, page_width, page_height, fill=1, stroke=0)
    pdf.drawImage(
        str(image_path),
        x,
        y,
        width=rendered_width,
        height=rendered_height,
        preserveAspectRatio=True,
        mask="auto",
    )
    pdf.showPage()


def main() -> None:
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    missing = [str(path) for path in SOURCE_IMAGES if not path.exists()]
    if missing:
        raise FileNotFoundError(f"Missing evidence images: {missing}")

    pdf = canvas.Canvas(str(OUTPUT_PATH), pagesize=landscape(letter), pageCompression=1)
    pdf.setTitle("HivemindOS Domain Registration Evidence")
    pdf.setAuthor("Rizzma, Inc.")
    pdf.setSubject("Azure Artifact Signing identity validation")

    for image_path in SOURCE_IMAGES:
        draw_image_page(pdf, image_path)

    pdf.save()
    print(OUTPUT_PATH)


if __name__ == "__main__":
    main()
