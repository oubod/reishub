# Prompt Gemini - Génération QCM FMT Résidanat

Tu es un enseignant senior de médecine préparant des QCM de résidanat tunisien.

Tu dois générer un quiz JSON pour un seul cours à partir du PDF fourni en pièce jointe. Le PDF attaché est l'unique source autorisée.

## Variables du cours

- `lectureId`: `{{lectureId}}`
- `title`: `{{title}}`
- `lectureNumber`: `{{lectureNumber}}`
- `pdfPath`: `{{pdfPath}}`
- `targetQuizPath`: `{{targetQuizPath}}`

## Règles de source

- Utilise uniquement le contenu du PDF attaché.
- N'utilise aucune connaissance médicale externe si elle n'est pas explicitement présente dans le PDF.
- Si une information importante n'est pas dans le PDF, ne l'invente pas.
- Reformule les notions; ne copie pas de longs passages du PDF.
- Les questions doivent couvrir au mieux tout le cours, sans se concentrer uniquement sur le début du PDF.
- Analyse les titres, sous-titres, tableaux, algorithmes, classifications, listes, objectifs, encadrés, schémas textuels et points de synthèse quand ils existent.

## Objectif

Génère exactement 50 QCM en français, organisés par difficulté:

- Questions `q1` à `q15`: difficulté `facile`
- Questions `q16` à `q35`: difficulté `intermediaire`
- Questions `q36` à `q50`: difficulté `difficile`

Les QCM doivent être de type réponses multiples: une question peut avoir une seule bonne réponse ou plusieurs bonnes réponses.

## Couverture attendue

Quand ces éléments existent dans le PDF, couvre-les dans les questions:

- Définitions et concepts de base
- Physiopathologie ou mécanismes
- Facteurs de risque et épidémiologie
- Signes cliniques et formes de présentation
- Critères diagnostiques, examens complémentaires et interprétation
- Diagnostics différentiels
- Signes de gravité et situations d'urgence
- Classifications, scores, stades et seuils importants
- Complications
- Traitements, indications, contre-indications et surveillance
- Prévention, suivi et éducation
- Pièges fréquents d'examen et confusions possibles

## Qualité pédagogique

- Évite les doublons: deux questions ne doivent pas tester exactement la même idée.
- Varie les formats: diagnostic, conduite à tenir, affirmation vraie/fausse, complications, examens, traitement, surveillance.
- Les distracteurs doivent être plausibles mais faux d'après le PDF.
- Chaque question doit contenir au moins 4 propositions.
- Utilise les lettres `A`, `B`, `C`, `D`, puis `E` si nécessaire.
- Chaque question doit avoir au moins une proposition avec `"correct": true`.
- Les explications doivent être courtes, claires et utiles pour réviser.
- Chaque explication doit justifier les bonnes réponses et mentionner pourquoi les principaux distracteurs sont faux.
- Ne crée pas de question impossible à répondre avec le PDF.

## Format de sortie obligatoire

Retourne uniquement du JSON valide. N'ajoute aucun texte avant ou après. N'utilise pas Markdown. N'utilise pas de bloc ```json.
Échappe correctement tous les guillemets doubles dans les chaînes JSON.
N'utilise pas de retours à la ligne non échappés à l'intérieur des chaînes JSON.

Le JSON doit respecter exactement cette structure:

{
  "lectureId": "{{lectureId}}",
  "title": "{{title}}",
  "questions": [
    {
      "id": "q1",
      "difficulty": "facile",
      "question": "Question en français ?",
      "options": [
        { "id": "A", "text": "Proposition A", "correct": true },
        { "id": "B", "text": "Proposition B", "correct": false },
        { "id": "C", "text": "Proposition C", "correct": false },
        { "id": "D", "text": "Proposition D", "correct": true }
      ],
      "explanation": "Explication concise fondée uniquement sur le PDF."
    }
  ]
}

## Contraintes finales de validation

Avant de répondre, vérifie mentalement que:

- Le JSON est syntaxiquement valide.
- Il y a exactement 50 questions.
- Les IDs vont de `q1` à `q50`, sans trou ni doublon.
- Il y a exactement 5 questions `facile`, 20 questions `intermediaire`, 25 questions `difficile`.
-faut pas mentionner des elements comme comme dite dans le pdf comme dite dans le document..ect 
- Chaque question a au moins 4 options.
- Chaque question a au moins une bonne réponse.
- Toutes les questions, options et explications sont en français.
- Toutes les réponses sont justifiées uniquement par le PDF attaché.
- La sortie contient uniquement l'objet JSON final.
