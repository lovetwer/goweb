# -*- coding: utf-8 -*-
"""
生成 MP 后台「虚拟支付 → 道具管理」所需的道具图片。

规格（后台限制）：PNG，200x200，小于 200KB。
配色直接取自小程序自身的 app.wxss 设计变量，保证道具图与站内视觉一致：
    暖白底  #faf7f2
    暖黑字  #2b2521
    陶土红  #b84827（站内「会员专属」卡片用的就是这条左边条）
    浅红线  #ecc9b6

用法：
    python scripts/gen-vip-icons.py

产物：
    assets/vip-icons/vip_month.png
    assets/vip-icons/vip_year.png
"""

import os
from PIL import Image, ImageDraw, ImageFont

SIZE = 200
BG = "#faf7f2"
INK = "#2b2521"
RED = "#b84827"
RED_LINE = "#ecc9b6"

FONT_BOLD = "C:/Windows/Fonts/msyhbd.ttc"
FONT_REG = "C:/Windows/Fonts/msyh.ttc"

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "assets", "vip-icons")

# (文件主名, 主字, 底部标签)
ICONS = [
    ("vip_month", "月", "会员"),
    ("vip_year", "年", "会员"),
]


def draw_icon(main_char, sub_label):
    img = Image.new("RGB", (SIZE, SIZE), BG)
    d = ImageDraw.Draw(img)

    BAR = 10  # 左侧陶土红竖条，呼应站内会员卡片的视觉标记

    d.rectangle([0, 0, BAR - 1, SIZE - 1], fill=RED)
    # 右侧留一条浅红描边，让整图在白色弹窗里也有边界感
    d.rectangle([BAR, 1, SIZE - 2, SIZE - 2], outline=RED_LINE, width=1)

    cx = BAR + (SIZE - BAR) // 2  # 竖条右侧区域的中心

    f_main = ImageFont.truetype(FONT_BOLD, 88)
    f_sub = ImageFont.truetype(FONT_REG, 26)

    # anchor="mm" = 以「水平垂直居中」定位，无需手算字宽
    d.text((cx, 84), main_char, font=f_main, fill=INK, anchor="mm")
    d.text((cx, 152), sub_label, font=f_sub, fill=RED, anchor="mm")

    return img


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for name, main_char, sub_label in ICONS:
        img = draw_icon(main_char, sub_label)
        path = os.path.join(OUT_DIR, f"{name}.png")

        # 先关掉抗锯齿产生的多余色深，再存成 8-bit PNG
        img = img.convert("P", palette=Image.ADAPTIVE, colors=64)
        img.save(path, "PNG", optimize=True)

        kb = os.path.getsize(path) / 1024
        w, h = Image.open(path).size
        flag = "OK" if (w == 200 and h == 200 and kb < 200) else "★ 超限"
        print(f"{flag}  {os.path.relpath(path)}  {w}x{h}  {kb:.1f} KB")


if __name__ == "__main__":
    main()
