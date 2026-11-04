"""Realistic noisy study documents, generated as REAL PDFs (repeated header/footer, page numbers, wrapped lines)."""
from fpdf import FPDF

EXAM_PAGES = [
    ["GUJARAT TECHNOLOGICAL UNIVERSITY", "MCA SEMESTER III - EXAMINATION - WINTER 2024", "Subject Code: 3640001                 Date: 12/01/2025",
     "Subject Name: Machine Learning", "Time: 02:30 PM TO 05:00 PM                 Total Marks: 70", "Instructions:", "1. Attempt all questions.",
     "2. Make suitable assumptions wherever necessary.", "3. Figures to the right indicate full marks.", "",
     "Q.1 (a) Define Machine Learning. Explain supervised learning with an example. [07]", "(b) What is overfitting? How can it be reduced? [07]",
     "Q.2 (a) Differentiate classification and regression. [07]"],
    ["(b) Explain gradient descent algorithm. [07]", "Q.3 (a) What is normalization in DBMS? Explain 1NF and 2NF. [07]", "(b) Write short note on confusion matrix. [07]",
     "OR", "Q.3 (a) Explain the K-means clustering algorithm. [07]"],
]

NOTES_PAGES = [
    ["2.1 Introduction to Machine Learning",
     "Machine Learning is a branch of Artificial Intelligence in which computers learn patterns from data and make predictions or decisions. It is widely used in",
     "recommendation systems, spam detection and house price prediction. The super-", "vised approach needs labelled data, whereas the unsupervised approach does not.",
     "2.2 Types of Machine Learning",
     "Supervised learning means training a model on labelled examples to predict outcomes. Classification predicts a category, while regression predicts a number."],
    ["Unsupervised learning is a technique in which the model finds hidden structure in unlabelled data. Clustering is the most common example.",
     "2.3 Model Evaluation",
     "Overfitting is a situation where a model learns noise in the training data and performs poorly on new data.",
     "The mean squared error is given by MSE = (1/n) * sum (y - y_pred)^2",
     "Accuracy = correct predictions / total predictions"],
    ["2.4 Gradient Descent",
     "Gradient descent is an optimisation algorithm that repeatedly moves the model parameters in the direction that reduces the loss.",
     "The update rule is w = w - alpha * dL/dw where alpha is the learning rate. A very large learning rate can make the loss diverge.",
     "Summary: In this unit we learnt the types of machine learning, how to evaluate a model and how gradient descent works."],
]


def make_pdf(pages: list[list[str]], header: str, footer_fmt: str = "Page {n} of {total}") -> bytes:
    pdf = FPDF(); pdf.set_auto_page_break(False)
    for n, lines in enumerate(pages, 1):
        pdf.add_page(); pdf.set_font("Helvetica", size=9); pdf.set_xy(10, 8); pdf.cell(0, 6, header)
        pdf.set_font("Helvetica", size=11); pdf.set_xy(10, 24)
        for ln in lines:
            pdf.multi_cell(0, 6, ln); pdf.ln(1)
        pdf.set_font("Helvetica", size=9); pdf.set_xy(10, 280); pdf.cell(0, 6, footer_fmt.format(n=n, total=len(pages)))
    return bytes(pdf.output())


def exam_pdf() -> bytes:
    return make_pdf(EXAM_PAGES, "GTU - Winter 2024 - Subject 3640001 - Machine Learning")


def notes_pdf() -> bytes:
    return make_pdf(NOTES_PAGES, "Machine Learning Notes - Unit 2 | Prepared by Prof. A. Shah")
