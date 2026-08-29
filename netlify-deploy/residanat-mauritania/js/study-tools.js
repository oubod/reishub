(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ResiStudyTools = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DIFFICULTY_COUNTS = { facile: 10, intermediaire: 12, difficile: 8 };

  function shuffle(items, random = Math.random) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function exactAnswer(question, selected) {
    const expected = question.options.filter((option) => option.correct).map((option) => option.id).sort();
    const actual = [...new Set(selected || [])].sort();
    return expected.length === actual.length && expected.every((id, index) => id === actual[index]);
  }

  function scoreExam(questions, answers) {
    const categories = {};
    let score = 0;
    let unanswered = 0;
    questions.forEach((question) => {
      const selected = answers[question.examId] || [];
      const correct = selected.length > 0 && exactAnswer(question, selected);
      const bucket = categories[question.category] ||= { score: 0, total: 0 };
      bucket.total += 1;
      if (!selected.length) unanswered += 1;
      if (correct) {
        score += 1;
        bucket.score += 1;
      }
    });
    return { score, total: questions.length, unanswered, categories };
  }

  function validateGeneratedQuiz(payload) {
    const source = payload && Array.isArray(payload.questions) ? payload.questions : [];
    if (source.length !== 30) throw new Error("Gemini doit retourner exactement 30 QCM.");
    const seenQuestions = new Set();
    const counts = { facile: 0, intermediaire: 0, difficile: 0 };
    const questions = source.map((question, index) => {
      const prompt = String(question.question || "").trim();
      const explanation = String(question.explanation || "").trim();
      const difficulty = String(question.difficulty || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (!prompt || !explanation || !(difficulty in counts)) throw new Error(`QCM ${index + 1}: contenu incomplet.`);
      const signature = prompt.toLowerCase().replace(/\s+/g, " ");
      if (seenQuestions.has(signature)) throw new Error(`QCM ${index + 1}: question dupliquée.`);
      seenQuestions.add(signature);
      counts[difficulty] += 1;
      if (!Array.isArray(question.options) || question.options.length < 4 || question.options.length > 5) {
        throw new Error(`QCM ${index + 1}: quatre ou cinq propositions sont requises.`);
      }
      const optionIds = new Set();
      const options = question.options.map((option, optionIndex) => {
        const id = String(option.id || "ABCDE"[optionIndex]).trim().toUpperCase();
        const text = String(option.text || "").trim();
        if (!/^[A-E]$/.test(id) || optionIds.has(id) || !text || typeof option.correct !== "boolean") {
          throw new Error(`QCM ${index + 1}: proposition invalide.`);
        }
        optionIds.add(id);
        return { id, text, correct: option.correct };
      });
      if (!options.some((option) => option.correct)) throw new Error(`QCM ${index + 1}: aucune réponse correcte.`);
      return { id: `ai-q${index + 1}`, question: prompt, difficulty, options, explanation };
    });
    Object.entries(DIFFICULTY_COUNTS).forEach(([difficulty, expected]) => {
      if (counts[difficulty] !== expected) throw new Error(`Répartition invalide: ${expected} QCM ${difficulty} requis.`);
    });
    return questions;
  }

  const geminiSchema = {
    type: "object",
    required: ["questions"],
    properties: {
      questions: {
        type: "array",
        minItems: 30,
        maxItems: 30,
        items: {
          type: "object",
          required: ["question", "difficulty", "options", "explanation"],
          properties: {
            question: { type: "string" },
            difficulty: { type: "string", enum: ["facile", "intermediaire", "difficile"] },
            options: {
              type: "array",
              minItems: 4,
              maxItems: 5,
              items: {
                type: "object",
                required: ["id", "text", "correct"],
                properties: {
                  id: { type: "string", enum: ["A", "B", "C", "D", "E"] },
                  text: { type: "string" },
                  correct: { type: "boolean" }
                }
              }
            },
            explanation: { type: "string" }
          }
        }
      }
    }
  };

  return { DIFFICULTY_COUNTS, shuffle, exactAnswer, scoreExam, validateGeneratedQuiz, geminiSchema };
});
