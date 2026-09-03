(function (root) {
  "use strict";

  function answers(question) {
    return Array.isArray(question.correct_answers) ? question.correct_answers : [question.correct_answer || "A"];
  }

  function buildPdfDefinition(quizzes, packTitle) {
    const list = (quizzes || []).filter((quiz) => quiz?.questions?.length);
    if (!list.length) throw new Error("Aucune épreuve à exporter.");
    const isPack = list.length > 1;
    const title = packTitle || (isPack ? "LIVRET D’ÉVALUATION MÉDICALE MULTIDISCIPLINAIRE" : list[0].title || list[0].subject || "Épreuve médicale");
    const total = list.reduce((sum, quiz) => sum + quiz.questions.length, 0);
    const date = new Date().toLocaleDateString("fr-FR");
    const flat = [];
    const content = [
      {
        columns: [
          { width: "auto", table: { body: [[{ text: "RÉSIHUB", fontSize: 8, bold: true, color: "#FFFFFF", fillColor: "#102D44", margin: [5, 3] }]] }, layout: "noBorders" },
          { width: "*", text: "RÉSIDANAT MAURITANIE · ÉVALUATION", fontSize: 8, bold: true, color: "#587080", margin: [8, 4, 0, 0] },
          { width: "auto", text: `${date} · ${total} QCM`, fontSize: 8, color: "#587080", alignment: "right", margin: [0, 4, 0, 0] }
        ],
        margin: [0, 0, 0, 7]
      },
      { text: title, fontSize: 16, bold: true, color: "#102D44", margin: [0, 4, 0, 3] },
      { text: isPack ? `${list.length} épreuves réunies` : `${list[0].specialty || "Médecine"} · Synthèse fidèle au document fourni`, fontSize: 9, bold: true, color: "#087A84", margin: [0, 0, 0, 8] },
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: 523, y2: 0, lineWidth: 1.2, lineColor: "#102D44" }], margin: [0, 0, 0, 12] }
    ];

    let number = 1;
    list.forEach((quiz, quizIndex) => {
      if (isPack) content.push({ text: `MODULE ${quizIndex + 1} · ${(quiz.subject || quiz.specialty || "ÉPREUVE").toUpperCase()}`, fontSize: 9, bold: true, color: "#102D44", fillColor: "#E7F1F2", margin: [6, 5, 6, 8] });
      quiz.questions.forEach((question) => {
        const correct = answers(question);
        const options = Object.entries(question.options || {});
        flat.push({ number, correct, explanation: question.explanation, source: question.reference || question.source_ref });
        content.push({
          unbreakable: true,
          margin: [0, 0, 0, 9],
          stack: [
            {
              columns: [
                { width: "auto", text: String(number).padStart(2, "0"), fontSize: 8, bold: true, color: "#FFFFFF", fillColor: "#102D44", margin: [5, 2] },
                { width: "auto", text: correct.length > 1 ? "QRM" : "QRU", fontSize: 8, bold: true, color: "#087A84", margin: [7, 3, 0, 0] },
                { width: "*", text: question.reference || question.source_ref || "Document fourni", fontSize: 7.5, color: "#78909C", alignment: "right", margin: [0, 3, 0, 0] }
              ],
              margin: [0, 0, 0, 4]
            },
            { text: `Question ${number}`, fontSize: 10, bold: true, color: "#102D44", margin: [0, 0, 0, 2] },
            { text: question.stem || question.question || "", fontSize: 10, bold: true, color: "#102D44", lineHeight: 1.25, margin: [0, 0, 0, 4] },
            {
              table: {
                widths: [18, "*"],
                body: options.map(([key, value]) => [
                  { text: key, fontSize: 8, bold: true, color: "#102D44", fillColor: "#F2F7F7", alignment: "center", margin: [0, 2] },
                  { text: String(value), fontSize: 9, color: "#334E60", margin: [4, 2] }
                ])
              },
              layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 1, paddingRight: () => 1, paddingTop: () => 1, paddingBottom: () => 1 }
            }
          ]
        });
        number += 1;
      });
    });

    content.push({ text: "SECTION II · CORRIGÉ ET JUSTIFICATIONS", pageBreak: "before", fontSize: 10, bold: true, color: "#FFFFFF", fillColor: "#102D44", margin: [7, 6, 7, 12] });
    content.push({ text: "GRILLE SYNTHÉTIQUE DES RÉPONSES", fontSize: 9, bold: true, color: "#102D44", margin: [0, 0, 0, 6] });
    const grid = [];
    for (let start = 0; start < flat.length; start += 10) {
      const row = flat.slice(start, start + 10);
      while (row.length < 10) row.push(null);
      grid.push(row.map((item) => ({ text: item ? `Q${item.number}` : "", fontSize: 7, bold: true, color: "#587080", fillColor: "#F2F7F7", alignment: "center", margin: [0, 2] })));
      grid.push(row.map((item) => ({ text: item ? item.correct.join(",") : "", fontSize: 8, bold: true, color: "#087A84", alignment: "center", margin: [0, 3] })));
    }
    content.push({ table: { widths: Array(10).fill("*"), body: grid }, layout: { hLineWidth: () => 0.4, vLineWidth: () => 0.4, hLineColor: () => "#D8E4E7", vLineColor: () => "#D8E4E7" }, margin: [0, 0, 0, 15] });
    flat.forEach((item) => content.push({
      unbreakable: true,
      table: {
        widths: ["*"],
        body: [[{
          fillColor: "#F2F7F7",
          margin: [8, 6],
          stack: [
            { text: `Question ${item.number} · Réponse : ${item.correct.join(", ")}`, fontSize: 9, bold: true, color: "#102D44" },
            { text: item.explanation || "Justification non disponible.", fontSize: 8.5, color: "#334E60", lineHeight: 1.25, margin: [0, 4, 0, 2] },
            { text: `Source : ${item.source || "Document fourni"}`, fontSize: 7.5, italics: true, color: "#78909C" }
          ]
        }]]
      },
      layout: { hLineWidth: () => 0.4, vLineWidth: (i) => i === 0 ? 3 : 0.4, hLineColor: () => "#D8E4E7", vLineColor: (i) => i === 0 ? "#D8784B" : "#D8E4E7" },
      margin: [0, 0, 0, 8]
    }));

    return {
      pageSize: "A4",
      pageMargins: [36, 48, 36, 44],
      header: (page) => page === 1 ? null : ({ margin: [36, 20, 36, 0], columns: [{ text: "RÉSIHUB · RÉSIDANAT MAURITANIE", fontSize: 7.5, bold: true, color: "#587080" }, { text: title.slice(0, 55), fontSize: 7.5, color: "#78909C", alignment: "right" }] }),
      footer: (page, pages) => ({ margin: [36, 0, 36, 18], columns: [{ text: "Contenu médical généré à vérifier", fontSize: 7.5, color: "#78909C" }, { text: `Page ${page} sur ${pages}`, fontSize: 7.5, bold: true, color: "#587080", alignment: "right" }] }),
      defaultStyle: { font: "Roboto" },
      content
    };
  }

  root.ResiAiPdf = { buildPdfDefinition };
})(globalThis);
