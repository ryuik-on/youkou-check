# 見本の書類のうち、事業計画書を Word（.docx）に、経費明細書を Excel（.xlsx）にする
# 申請書の様式は Word や Excel で配られることが多いので、その形でも読めるかを確かめるため
# 要るもの：python-docx と openpyxl（pip install python-docx openpyxl）
import re
from html.parser import HTMLParser
from pathlib import Path

import docx
import openpyxl
from openpyxl.styles import Font

HERE = Path(__file__).parent


class Blocks(HTMLParser):
    """HTML を、見出し・段落・表の並びにする"""

    def __init__(self):
        super().__init__()
        self.blocks, self.text, self.table, self.row, self.tag = [], "", None, None, None

    def handle_starttag(self, tag, attrs):
        if tag in ("h1", "h2", "h3", "p", "div", "td", "th"):
            self.tag, self.text = tag, ""
        elif tag == "table":
            self.table = []
        elif tag == "tr":
            self.row = []
        if tag in ("td", "th"):
            self.colspan = int(dict(attrs).get("colspan", 1))

    def handle_endtag(self, tag):
        t = re.sub(r"\s+", " ", self.text).strip()
        if tag in ("td", "th"):
            self.row.append((t, tag == "th", self.colspan))
        elif tag == "tr":
            self.table.append(self.row)
        elif tag == "table":
            self.blocks.append(("table", self.table))
            self.table = None
        elif tag in ("h1", "h2", "h3", "p", "div") and self.table is None:
            self.blocks.append((tag, t))
        if tag == self.tag:
            self.tag = None

    def handle_data(self, data):
        if self.tag:
            self.text += data


def read(name):
    p = Blocks()
    p.feed((HERE / "src" / f"{name}.html").read_text(encoding="utf-8"))
    return p.blocks


def to_docx(name):
    d = docx.Document()
    for kind, value in read(name):
        if kind == "h1":
            d.add_heading(value, 1)
        elif kind in ("h2", "h3"):
            d.add_heading(value, 2)
        elif kind in ("p", "div"):
            d.add_paragraph(value)
        else:
            width = max(sum(c[2] for c in r) for r in value)
            t = d.add_table(rows=len(value), cols=width)
            t.style = "Table Grid"
            for i, r in enumerate(value):
                j = 0
                for text, _, span in r:
                    cell = t.cell(i, j) if span == 1 else t.cell(i, j).merge(t.cell(i, j + span - 1))
                    cell.text = text
                    j += span
    d.save(HERE / "office" / f"{name}.docx")


def to_xlsx(name):
    wb = openpyxl.Workbook()
    ws = wb.active
    for kind, value in read(name):
        if kind in ("h1", "h2", "h3", "p", "div"):
            ws.append([value])
            if kind == "h1":
                ws.cell(ws.max_row, 1).font = Font(bold=True, size=14)
        elif kind == "table":
            for r in value:
                row = ws.max_row + 1
                col = 1
                for text, head, span in r:
                    m = re.fullmatch(r"([\d,]+)円", text)
                    cell = ws.cell(row, col, int(m[1].replace(",", "")) if m else text)
                    if m:
                        cell.number_format = '#,##0"円"'
                    if head:
                        cell.font = Font(bold=True)
                    if span > 1:
                        ws.merge_cells(start_row=row, start_column=col, end_row=row, end_column=col + span - 1)
                    col += span
    ws.title = "経費明細"
    wb.save(HERE / "office" / f"{name}.xlsx")


(HERE / "office").mkdir(exist_ok=True)
to_docx("keikaku")
to_xlsx("keihi")
print("office/keikaku.docx office/keihi.xlsx")
