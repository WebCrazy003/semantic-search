# backend/tests/fixtures/make_fixtures.py
"""Build the CJK test corpus with PyMuPDF's built-in CJK fonts.

No font files and no network. Run it directly to inspect the PDFs by eye:
    uv run --directory backend python -m tests.fixtures.make_fixtures /tmp/pdfs
"""

from __future__ import annotations

import sys
from pathlib import Path

import fitz

CHINESE_FONT = "china-ss"
KOREAN_FONT = "korea-s"
LATIN_FONT = "helv"

CHINESE_FILTER_SENTENCE = (
    "在更换滤芯之前，必须先关闭主电源开关，并等待设备完全冷却至室温。"
)
KOREAN_FILTER_SENTENCE = (
    "필터를 교체하기 전에 반드시 주 전원 스위치를 끄고 장비가 완전히 식을 때까지 기다리십시오."
)

_CHINESE_PAGES: list[tuple[str, list[str]]] = [
    (
        "第一章 安全注意事项",
        [
            CHINESE_FILTER_SENTENCE,
            "操作人员必须佩戴防护手套和护目镜。未经培训的人员不得拆卸任何部件。",
            "如果设备发出异常噪音或出现漏水，应立即停止运行并联系维修人员。",
        ],
    ),
    (
        "第二章 日常维护",
        [
            "每周检查压力表读数。正常工作压力范围为 3.5 至 4.2 MPa。",
            "每月清洗进水口滤网一次。滤网型号为 XJ-200B，可使用清水冲洗后重复使用。",
            "润滑油应每六个月更换一次。请使用制造商指定的 SAE 40 型润滑油。",
        ],
    ),
    (
        "第三章 保修条款",
        [
            "本设备自购买之日起提供两年保修服务，保修范围覆盖制造缺陷。",
            "因操作不当、擅自改装或使用非原厂配件造成的损坏不在保修范围内。",
            "保修期内的维修请联系授权服务中心，并提供购买凭证和设备序列号。",
        ],
    ),
]

_KOREAN_PAGES: list[tuple[str, list[str]]] = [
    (
        "제1장 안전 주의사항",
        [
            KOREAN_FILTER_SENTENCE,
            "작업자는 보호 장갑과 보안경을 반드시 착용해야 합니다.",
            "장비에서 이상한 소음이나 누수가 발생하면 즉시 운전을 중지하십시오.",
        ],
    ),
    (
        "제2장 정기 점검",
        [
            "압력계 수치를 매주 확인하십시오. 정상 작동 압력은 3.5에서 4.2 MPa 입니다.",
            "급수구 여과망은 매월 한 번 세척하십시오. 여과망 모델은 XJ-200B 입니다.",
            "윤활유는 6개월마다 교체하며 제조사가 지정한 SAE 40 등급을 사용하십시오.",
        ],
    ),
    (
        "제3장 보증 조건",
        [
            "본 장비는 구매일로부터 2년간 제조 결함에 대한 보증을 제공합니다.",
            "잘못된 조작이나 비정품 부품 사용으로 인한 손상은 보증에서 제외됩니다.",
            "보증 수리는 공인 서비스 센터에 구매 증빙과 함께 요청하십시오.",
        ],
    ),
]

_TABLE_ROWS = [
    ["部件 / 부품", "周期 / 주기", "型号 / 모델"],
    ["滤芯 / 필터", "每月 / 매월", "XJ-200B"],
    ["润滑油 / 윤활유", "六个月 / 6개월", "SAE 40"],
    ["密封圈 / 실링", "每年 / 매년", "RS-14"],
]


def _font_for(text: str) -> str:
    if any("가" <= ch <= "힣" for ch in text):
        return KOREAN_FONT
    if any("一" <= ch <= "鿿" for ch in text):
        return CHINESE_FONT
    return LATIN_FONT


def _write_page(document: fitz.Document, heading: str, paragraphs: list[str]) -> None:
    page = document.new_page(width=595, height=842)  # A4
    cursor = 72.0
    page.insert_textbox(
        fitz.Rect(56, cursor, 539, cursor + 40),
        heading,
        fontsize=18,
        fontname=_font_for(heading),
    )
    cursor += 48
    for paragraph in paragraphs:
        height = 24 + 16 * (len(paragraph) // 34)
        page.insert_textbox(
            fitz.Rect(56, cursor, 539, cursor + height),
            paragraph,
            fontsize=11,
            fontname=_font_for(paragraph),
        )
        cursor += height + 14


def _write_table_page(document: fitz.Document) -> None:
    """A page with ruled lines so PyMuPDF's find_tables detects a real table."""
    page = document.new_page(width=595, height=842)
    page.insert_textbox(
        fitz.Rect(56, 60, 539, 100),
        "附录 A 维护周期表 / 부록 A 정비 주기표",
        fontsize=16,
        fontname=CHINESE_FONT,
    )
    left, top, row_height = 56.0, 120.0, 30.0
    widths = [180.0, 150.0, 150.0]
    for row_index, row in enumerate(_TABLE_ROWS):
        y0 = top + row_index * row_height
        x0 = left
        for column_index, cell in enumerate(row):
            rect = fitz.Rect(x0, y0, x0 + widths[column_index], y0 + row_height)
            page.draw_rect(rect, color=(0, 0, 0), width=0.7)
            page.insert_textbox(
                rect + (4, 8, -4, -4), cell, fontsize=10, fontname=_font_for(cell)
            )
            x0 += widths[column_index]


def build_chinese_manual(path: Path) -> Path:
    document = fitz.open()
    for heading, paragraphs in _CHINESE_PAGES:
        _write_page(document, heading, paragraphs)
    document.set_metadata({"title": "设备使用手册"})
    document.save(path)
    document.close()
    return path


def build_korean_manual(path: Path) -> Path:
    document = fitz.open()
    for heading, paragraphs in _KOREAN_PAGES:
        _write_page(document, heading, paragraphs)
    document.set_metadata({"title": "장비 사용 설명서"})
    document.save(path)
    document.close()
    return path


def build_mixed_manual(path: Path) -> Path:
    """One Chinese page, one Korean page, and a ruled table page."""
    document = fitz.open()
    _write_page(document, *_CHINESE_PAGES[1])
    _write_page(document, *_KOREAN_PAGES[1])
    _write_table_page(document)
    document.set_metadata({"title": "Maintenance Guide 维护指南 정비 안내"})
    document.save(path)
    document.close()
    return path


def build_scanned_stand_in(path: Path) -> Path:
    """A PDF with a drawing and no text, standing in for a scanned page.

    OCR is out of scope, so the indexer must classify this as unsupported.
    """
    document = fitz.open()
    page = document.new_page(width=595, height=842)
    page.draw_rect(fitz.Rect(80, 80, 515, 700), color=(0.2, 0.2, 0.2), width=2)
    page.draw_line(fitz.Point(80, 400), fitz.Point(515, 400))
    document.save(path)
    document.close()
    return path


# ---------------------------------------------------------------- word wrapping

WRAP_KOREAN_TEXT = (
    "필터를 교체하기 전에 반드시 주 전원 스위치를 끄고 장비가 완전히 식을 때까지 "
    "기다리십시오. 유지보수 주기는 사용 환경에 따라 달라지며 먼지가 많은 곳에서는 "
    "점검 간격을 절반으로 줄여야 합니다. 압력계 수치를 매주 확인하고 정상 범위를 "
    "벗어나면 즉시 운전을 중지하십시오. 윤활유는 제조사가 지정한 등급만 사용하며 "
    "교체한 날짜를 점검 기록부에 남겨 두십시오. 보증 수리를 요청할 때에는 구매 "
    "증빙과 장비 일련번호를 함께 제출해야 합니다."
)
_WRAP_KOREAN_WIDTH = 17  # characters per line, so breaks fall inside words


def _character_wrap(text: str, width: int) -> list[str]:
    """Break every `width` characters, as HWP and Word do for Korean by default.

    A break that lands on a space keeps the space at the end of the line, which is
    what most generators write and what the extractor uses as evidence.
    """
    lines: list[str] = []
    start = 0
    while start < len(text):
        end = min(start + width, len(text))
        line = text[start:end]
        if end < len(text) and text[end] == " ":
            line += " "
            end += 1
        lines.append(line)
        start = end
    return lines


def _write_lines(page: fitz.Page, lines: list[str], top: float, step: float = 14) -> float:
    y = top
    for line in lines:
        page.insert_text((56, y), line, fontsize=11, fontname=_font_for(line))
        y += step
    return y


def build_wrap_english(path: Path) -> Path:
    """Hyphenation of every kind, a paragraph split into two blocks, and a word
    split across a page break with a page-number footer in between."""
    document = fitz.open()
    first = document.new_page(width=595, height=842)
    _write_lines(
        first,
        [
            "Before any work, isolate the power supply and wait for the mainte-",
            "nance light to switch off. The state-of-the-",
            "art controller reports COVID-",
            "19 lockout codes and ISO-",
            "9001 audit results. Keep the main\u00ad",
            "tenance log with the unit.",
        ],
        100,
    )
    # 20 pt apart: MuPDF puts these two lines in separate blocks.
    _write_lines(first, ["The seal inspec-", "tion takes place every week."], 220, step=20)
    _write_lines(first, ["All readings must be recorded in the inspec-"], 780)
    first.insert_text((280, 826), "Page 1", fontsize=9, fontname=LATIN_FONT)

    second = document.new_page(width=595, height=842)
    _write_lines(second, ["tion report before restarting the unit."], 80)
    second.insert_text((280, 826), "Page 2", fontsize=9, fontname=LATIN_FONT)
    document.save(path)
    document.close()
    return path


def build_wrap_korean(path: Path, *, trailing_spaces: bool = True) -> Path:
    """Korean broken mid-word. Without trailing spaces there is no evidence."""
    # Twice over, so there are enough line ends for the extractor to judge by.
    lines = _character_wrap(WRAP_KOREAN_TEXT + " " + WRAP_KOREAN_TEXT, _WRAP_KOREAN_WIDTH)
    if not trailing_spaces:
        lines = [line.rstrip() for line in lines]
    document = fitz.open()
    page = document.new_page(width=595, height=842)
    _write_lines(page, lines, 100)
    document.save(path)
    document.close()
    return path


def build_wrapping(directory: Path) -> list[Path]:
    """Kept out of build_all, whose document count other tests rely on."""
    directory.mkdir(parents=True, exist_ok=True)
    return [
        build_wrap_english(directory / "wrap_en.pdf"),
        build_wrap_korean(directory / "wrap_ko_charwrap.pdf"),
        build_wrap_korean(directory / "wrap_ko_nospace.pdf", trailing_spaces=False),
    ]


def build_all(directory: Path) -> list[Path]:
    directory.mkdir(parents=True, exist_ok=True)
    return [
        build_chinese_manual(directory / "manual_zh.pdf"),
        build_korean_manual(directory / "manual_ko.pdf"),
        build_mixed_manual(directory / "manual_mixed.pdf"),
        build_scanned_stand_in(directory / "empty_scan_zh.pdf"),
    ]


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/tmp/sps-fixtures")
    for created in build_all(target) + build_wrapping(target / "wrapping"):
        print(created)
