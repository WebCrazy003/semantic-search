"""The corpus the answer evaluation runs on: three short manuals, one per language.

Each manual is about a different machine with its own numbers, so every question in
answer_set.json has exactly one right page, and a question in one language about a
manual in another tests the cross-language path.

    uv run --directory backend python -m eval.answer_corpus /tmp/answer-corpus
"""

from __future__ import annotations

import sys
from pathlib import Path

import fitz

from tests.fixtures.make_fixtures import _write_page

PUMP_ZH: list[tuple[str, list[str]]] = [
    (
        "第一章 技术参数",
        [
            "本离心泵额定流量为 50 m³/h，额定扬程为 32 m，电机功率为 7.5 kW，转速为 2900 r/min。",
            "正常工作压力为 0.3 至 0.6 MPa，最高工作压力为 1.0 MPa。介质温度范围为 -10 °C 至 80 °C。",
        ],
    ),
    (
        "第二章 机械密封",
        [
            "机械密封应每运行 2000 小时检查一次。若泄漏量超过每分钟 5 滴，应立即更换密封组件（部件号 MS-200）。",
            "更换前必须关闭进出口阀门并排空泵腔内的液体。安装新密封时，压盖螺栓应按对角顺序分三次拧紧，最终扭矩为 25 N·m。",
        ],
    ),
    (
        "第三章 滤芯更换",
        [
            "滤芯每三个月更换一次；若压差表读数超过 0.15 MPa，应提前更换。",
            "拆下滤筒盖后逆时针旋出旧滤芯，检查 O 形圈是否老化。新滤芯装入后需手动排气，直至排气阀连续出液。",
        ],
    ),
]

COMPRESSOR_KO: list[tuple[str, list[str]]] = [
    (
        "제1장 사양",
        [
            "본 공기압축기의 토출 압력은 0.8 MPa 이며 공기 탱크 용량은 200 L 입니다.",
            "안전밸브 설정 압력은 0.95 MPa 이고 운전 소음은 1 m 거리에서 68 dB 입니다.",
        ],
    ),
    (
        "제2장 정기 점검",
        [
            "응축수는 매일 작업이 끝난 뒤 탱크 하부의 드레인 밸브를 열어 배출하십시오.",
            "압축기 오일은 운전 500시간마다 교체하며 ISO VG 46 등급의 압축기 전용 오일을 사용하십시오. 흡입 필터는 매주 청소하십시오.",
        ],
    ),
    (
        "제3장 보증",
        [
            "보증 기간은 설치일로부터 24개월 또는 출하일로부터 30개월 중 먼저 도래하는 기간으로 합니다.",
            "소모품(오일, 흡입 필터, 벨트)은 보증 대상에서 제외됩니다.",
        ],
    ),
]

CHILLER_EN: list[tuple[str, list[str]]] = [
    (
        "1 Specifications",
        [
            "The chiller has a cooling capacity of 12 kW. It uses refrigerant R-513A with a "
            "factory charge of 3.2 kg.",
            "Supply water temperature can be set between 5 °C and 15 °C.",
        ],
    ),
    (
        "2 Alarms",
        [
            "Alarm E-04 means low inlet pressure. Check that the suction valve is fully open "
            "and the strainer is clean. If the alarm lasts more than 10 minutes the "
            "controller stops the pump.",
            "Alarm E-07 means motor overtemperature: the winding is above 140 °C. Let the "
            "motor cool for at least 30 minutes and check the ventilation grille before "
            "resetting.",
        ],
    ),
    (
        "3 Maintenance",
        [
            "Clean the condenser fins every 3 months with a soft brush.",
            "Replace the coolant, 30% propylene glycol, every 2 years.",
        ],
    ),
]

MANUALS = {
    "pump_zh.pdf": PUMP_ZH,
    "compressor_ko.pdf": COMPRESSOR_KO,
    "chiller_en.pdf": CHILLER_EN,
}


def build(directory: Path) -> list[Path]:
    directory.mkdir(parents=True, exist_ok=True)
    paths = []
    for filename, pages in MANUALS.items():
        document = fitz.open()
        for heading, paragraphs in pages:
            _write_page(document, heading, paragraphs)
        path = directory / filename
        document.save(path)
        document.close()
        paths.append(path)
    return paths


if __name__ == "__main__":
    for written in build(Path(sys.argv[1] if len(sys.argv) > 1 else "answer-corpus")):
        print(written)
