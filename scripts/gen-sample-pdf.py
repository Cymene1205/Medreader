"""
Generate a small sample scientific-style PDF to test MedReader Agent.
"""
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Image as RLImage
from reportlab.lib import colors
import os

OUT = "/home/z/my-project/download/sample-paper.pdf"

doc = SimpleDocTemplate(
    OUT, pagesize=A4,
    leftMargin=2*cm, rightMargin=2*cm,
    topMargin=2*cm, bottomMargin=2*cm,
    title="Sample Scientific Paper"
)

styles = getSampleStyleSheet()
title_style = ParagraphStyle('TitleX', parent=styles['Title'], fontSize=16, leading=20)
h1 = ParagraphStyle('H1X', parent=styles['Heading1'], fontSize=13, leading=16, spaceBefore=10, spaceAfter=6)
body = ParagraphStyle('BodyX', parent=styles['Normal'], fontSize=10, leading=14, alignment=4)

story = []
story.append(Paragraph("Lactation and Parity Reduce Triple-Negative Breast Cancer Risk via CD8+ Tissue-Resident Memory T Cells", title_style))
story.append(Spacer(1, 6))
story.append(Paragraph("A Sample Scientific Paper for Testing MedReader Agent", styles['Italic']))
story.append(Spacer(1, 12))

story.append(Paragraph("1. Introduction", h1))
story.append(Paragraph(
    "Epidemiological studies have long observed that parity (the number of previous pregnancies) and "
    "lactation (breastfeeding) reduce the long-term risk of breast cancer in women, particularly "
    "triple-negative breast cancer (TNBC), an aggressive subtype with poor prognosis. However, the "
    "biological mechanisms underlying this protective effect, especially the immunological mechanisms, "
    "have remained unclear. In this study, we hypothesize that parity and lactation reshape the immune "
    "microenvironment of mammary tissue, particularly by inducing and maintaining CD8+ tissue-resident "
    "memory T (TRM) cells, thereby enhancing immune surveillance against breast cancer.", body))
story.append(Spacer(1, 6))

story.append(Paragraph("2. Results", h1))
story.append(Paragraph("2.1 Parous mammary tissue is enriched in CD8+ TRM cells", h1))
story.append(Paragraph(
    "We compared the immune cell composition of normal mammary tissue from parous and nulliparous women. "
    "Single-cell RNA-seq analysis of large cohorts revealed that parous tissue was significantly enriched "
    "in CD8+ T cells, particularly those with a TRM phenotype (CD69+CD103+). These cells persisted for "
    "decades after pregnancy. Multiplex immunofluorescence confirmed the spatial localization of these "
    "cells around mammary ducts.", body))
story.append(Spacer(1, 6))

story.append(Paragraph("2.2 Mouse model of lactation and involution", h1))
story.append(Paragraph(
    "We established a mouse model with three groups: virgin, full lactation and involution (d28-inv), and "
    "forced weaning (d10-FW). Only the d28-inv group showed a significant increase in CD8+ T cells in the "
    "mammary fat pad. Tumor challenge experiments using AT3-OVA TNBC cells revealed that only d28-inv mice "
    "exhibited significant tumor growth inhibition, accompanied by increased CD8+ T cell infiltration.", body))
story.append(Spacer(1, 6))

story.append(Paragraph("2.3 CD8+ T cells are required for protection", h1))
story.append(Paragraph(
    "In RAG-/-gc-/- mice lacking T, B, and NK cells, the protective effect of parity was abolished. "
    "Depletion of CD8+ T cells using anti-CD8a and anti-CD8b antibodies eliminated the tumor protection "
    "in d28-inv mice. Treatment with FTY720, which blocks lymphocyte egress from lymph nodes, partially "
    "reduced the protective effect, demonstrating contributions from both tissue-resident and peripherally "
    "recruited T cells. Adoptive transfer of OT-I CD8+ T cells into RAG-/- mice partially restored protection.", body))

# Add a figure-like rectangle (as a placeholder image)
story.append(Spacer(1, 10))
story.append(Paragraph("Figure 1. Experimental design and key findings summary", h1))

# Draw a simple bar chart using matplotlib
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

fig, ax = plt.subplots(figsize=(5, 3), constrained_layout=True)
groups = ['Virgin', 'd10-FW', 'd28-inv']
counts = [12, 18, 65]
ax.bar(groups, counts, color=['#999', '#f5a623', '#3370ff'])
ax.set_ylabel('CD8+ T cells per mg tissue')
ax.set_title('CD8+ TRM cell accumulation after involution')
fig_path = "/home/z/my-project/download/_tmp_fig.png"
fig.savefig(fig_path, dpi=120)
plt.close(fig)

story.append(RLImage(fig_path, width=12*cm, height=7.2*cm))

story.append(PageBreak())
story.append(Paragraph("3. Discussion", h1))
story.append(Paragraph(
    "Our study reveals that the protective effect of parity and lactation against TNBC is mediated by "
    "CD8+ TRM cells that accumulate in mammary tissue during the involution phase. This finding has "
    "significant implications for breast cancer prevention: strategies that mimic the post-lactation "
    "immune state could potentially be developed for high-risk women such as BRCA mutation carriers. "
    "Furthermore, our PB-TRM gene signature could serve as a predictive biomarker for immunotherapy "
    "response in TNBC patients.", body))
story.append(Spacer(1, 6))

story.append(Paragraph("4. Methods", h1))
story.append(Paragraph(
    "Single-cell RNA-seq data were re-analyzed from published datasets. Flow cytometry and multiplex OPAL "
    "immunofluorescence were performed on fresh normal mammary tissue from reduction mammoplasties. "
    "Mouse mammary tissue was harvested at various time points during the reproductive cycle. Orthotopic "
    "tumor implantation was performed by injecting AT3-OVA or D2A1 cells into the mammary fat pad. "
    "In vivo depletion experiments used anti-CD4, anti-CD8a, and anti-CD8b antibodies. Adoptive transfer "
    "experiments used OT-I T cells in RAG-/- recipients.", body))

doc.build(story)
print(f"Sample PDF created at {OUT}")
print(f"Size: {os.path.getsize(OUT)} bytes")
