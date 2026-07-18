# Sécurité

## Signaler une vulnérabilité

N’ouvrez pas de ticket public contenant une clé, une adresse d’enfant ou un pack privé. Contactez le mainteneur de l’instance ou utilisez le canal privé du dépôt Forgejo.

## Modèle de sécurité

- une instance correspond à une famille et possède un seul administrateur ;
- le mot de passe est haché avec Argon2id ;
- les clés fournisseurs sont chiffrées par AES-256-GCM avec `APP_ENCRYPTION_KEY` ;
- `APP_ENCRYPTION_KEY` et `N8N_SHARED_SECRET` ne doivent jamais être stockés dans la base ni committés ;
- les mutations authentifiées exigent le cookie de session et le jeton CSRF ;
- les callbacks n8n sont signés HMAC-SHA256, expirent après cinq minutes et sont protégés contre le rejeu ;
- la clé du store est comparée en temps constant et doit être traitée comme un mot de passe ;
- les journaux masquent les chaînes ressemblant à des clés ou jetons.

En production HTTPS, définir `COOKIE_SECURE=true`. Ne rendez pas le store accessible sans HTTPS sur Internet : sa clé est transmise dans l’URL pour rester compatible avec Telmi Sync.
