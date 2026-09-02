# Déploiement de l’IA Mauritanie

1. Exécuter `supabase_mauritania_ai_jobs.sql` dans le SQL Editor.
2. Définir les secrets Edge `AI_KEY_ENCRYPTION_SECRET` et `AI_WORKER_TOKEN` (deux valeurs longues et aléatoires).
3. Déployer `mauritania-ai-jobs` puis `mauritania-ai-worker`.
4. Ajouter dans Vault `project_url` et `mauritania_ai_worker_token`, puis activer la commande Cron commentée à la fin du SQL.

Le traitement fiable hors application commence lorsque l’état affiché est **En attente**.
