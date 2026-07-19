# Plan d'implémentation — Telmi AI Studio

## Objectif

Construire une application web mono-utilisateur, open source et auto-hébergeable permettant à un parent de générer, contrôler, compiler et publier des histoires interactives compatibles avec Telmi OS.

Ce document est un plan d'exécution. Son adoption ne lance aucune étape automatiquement.

## Paramètres d'exécution recommandés

- Modèle principal : `gpt-5.6-sol`
- Effort courant : `high`
- Effort ponctuel `xhigh` : compilateur Telmi, validateur de graphe, sécurité des secrets et revue d'architecture
- Méthode : progression par étapes avec tests et validation à chaque jalon
- Langue : français

## Contraintes invariantes

- application mono-utilisateur ;
- licence AGPL-3.0 ;
- thème clair uniquement ;
- interface responsive ordinateur et mobile ;
- aucune génération de médias avant validation parentale ;
- orchestration interne séquentielle et reprenable ;
- stockage local sur disque ;
- base SQLite ;
- dépôt Forgejo principal avec miroir GitHub ;
- aucune marketplace publique ;
- aucun lecteur interactif dans le navigateur pour le MVP ;
- import manuel du ZIP dans Telmi Sync ;
- compatibilité avec la dernière version de Telmi OS.

## Architecture cible

```text
Next.js + TypeScript
├── Interface React
├── API serveur
├── Authentification mono-administrateur
├── SQLite + Drizzle ORM
├── Stockage local des médias
├── Adaptateurs fournisseurs IA
├── File interne de génération
├── Validateur narratif
├── Compilateur Telmi
└── API du store privé
```

## Étape 0 — Fondation technique

### Travail

- initialiser Next.js, React et TypeScript ;
- configurer lint, formatage, tests unitaires et tests E2E ;
- ajouter Dockerfile et Docker Compose ;
- configurer SQLite et Drizzle ;
- structurer les domaines applicatifs ;
- ajouter AGPL-3.0 ;
- documenter le lancement local ;
- préserver le store Docker de test existant pendant la transition.

### Validation

- application accessible localement ;
- base initialisée automatiquement ;
- tests exécutables ;
- données persistantes après redémarrage Docker.

## Étape 1 — Dictionnaire de données et modèle métier

### Entités

- `InstallationSettings`
- `Admin`
- `Story`
- `StoryVersion`
- `Scene`
- `Choice`
- `GenerationJob`
- `GeneratedAsset`
- `ProviderConfiguration`
- `UsageRecord`
- `Notification`
- `TrashEntry`
- `Backup`

### Travail

- rédiger le dictionnaire de données ;
- créer le schéma et les migrations ;
- gérer les versions d'histoires ;
- implémenter la corbeille récupérable ;
- stocker journaux, coûts et erreurs ;
- gérer budget mensuel et plafond par histoire.

### Validation

- créer et modifier une histoire ;
- conserver ou remplacer une version ;
- restaurer une histoire supprimée ;
- calculer correctement les consommations.

## Étape 2 — Installation, authentification et paramètres

### Travail

- assistant de première installation ;
- mot de passe administrateur ;
- prénom par défaut de l'enfant ;
- URL publique ;
- configuration des fournisseurs ;
- stockage protégé des secrets ;
- configuration de la file interne de génération ;
- configuration du store et de son jeton ;
- tests de connexion.

### Validation

- installation depuis une base vide ;
- authentification et déconnexion ;
- secrets masqués et absents des réponses API ;
- travaux persistants et reprenables après redémarrage.

## Étape 3 — Contrat narratif JSON

### Travail

- définir un schéma JSON versionné ;
- intégrer une API compatible OpenAI/OpenRouter ;
- produire les prompts adaptés à l'âge ;
- stocker les réponses brutes ;
- calculer scènes, parcours, durée et coût estimés ;
- ajouter la validation parentale.

### Validation

- réponse non conforme rejetée ;
- JSON valide transformé en histoire éditable ;
- aucun média généré avant validation.

## Étape 4 — Validateur de graphe

### Contrôles

- identifiants uniques ;
- destinations existantes ;
- scène initiale valide ;
- scènes inaccessibles ;
- cycles non autorisés ;
- chemins conduisant à une fin ;
- cohérence décisions, choix et durée ;
- avertissements de contenu adaptés à l'âge.

### Validation

- corpus de graphes valides et invalides ;
- erreurs rattachées aux scènes concernées ;
- avertissements de contenu non bloquants.

## Étape 5 — Compilateur et validateur Telmi

### Travail

- générer `metadata.json`, `nodes.json` et `notes.json` ;
- produire les scènes et actions déterministes ;
- générer `backAction` ;
- garantir une action `ok` distincte par scène ;
- contrôler les PNG 640 × 480 ;
- contrôler les MP3 44,1 kHz et leur débit ;
- créer et valider le ZIP ;
- comparer le résultat au pack de référence.

### Validation

- import du ZIP dans Telmi Sync ;
- parcours de toutes les branches ;
- test réel sur Miyoo Mini Plus.

## Étape 6 — Orchestration interne et fournisseurs de médias

### Travail

- exécuter les travaux dans une file interne séquentielle ;
- conserver l’état et les étapes en SQLite ;
- reprendre automatiquement un travail interrompu ;
- intégrer ElevenLabs et récupérer les voix autorisées ;
- créer un adaptateur d'images interchangeable ;
- gérer la régénération sélective ;
- suivre progression, coûts et erreurs ;
- reprendre un traitement interrompu sans doublon.

### Validation

- aucune API interne d’orchestration exposée ;
- régénération d'un seul média ;
- reprise après erreur ;
- absence de doublons.

## Étape 7 — Bibliothèque et store privé

### Travail

- bibliothèque avec couvertures ;
- recherche titre et description ;
- téléchargement ZIP ;
- publication et retrait du store ;
- versions et corbeille ;
- endpoint Telmi protégé par jeton ;
- rotation du jeton ;
- remplacement progressif du store Docker temporaire.

### Validation

- histoire visible dans Telmi Sync ;
- téléchargement fonctionnel ;
- mauvaise clé refusée ;
- retrait du store sans suppression de l'histoire.

## Étape 8 — Interface issue du design Claude

### Travail

- importer les tokens et composants validés ;
- tableau de bord ;
- assistant en cinq étapes ;
- vue scènes ;
- vue graphe avec React Flow ;
- suivi de génération ;
- bibliothèque ;
- corbeille ;
- paramètres ;
- responsive et accessibilité AA.

### Validation

- comparaison aux maquettes ;
- tests ordinateur et mobile ;
- navigation clavier ;
- états vide, chargement, succès, avertissement et erreur.

## Étape 9 — Exploitation et distribution

### Travail

- sauvegarde et restauration complètes ;
- consultation des journaux ;
- notifications ;
- vérification des mises à jour ;
- documentation Docker et orchestration interne ;
- Forgejo comme dépôt principal ;
- miroir automatique GitHub ;
- procédure de migration et rollback.

### Validation

- restauration sur installation vierge ;
- miroir GitHub vérifié ;
- mise à jour documentée sans perte de données.

## Étape 10 — Validation finale

- tests unitaires et d'intégration ;
- tests E2E ;
- revue de sécurité ;
- test des budgets et coûts ;
- test Telmi Sync ;
- test Miyoo Mini Plus ;
- test de sauvegarde/restauration ;
- installation complète depuis un clone vierge ;
- documentation utilisateur et administrateur.

## Ordre d'exécution pendant l'attente du design

1. Étape 0 — fondation technique
2. Étape 1 — modèle métier
3. Étape 2 — installation et paramètres
4. Étape 3 — contrat narratif
5. Étape 4 — validateur de graphe
6. Étape 5 — compilateur Telmi
7. Étape 6 — orchestration interne
8. Attendre/importer le design avant la finition de l'étape 8

## Commande de reprise

Dans une prochaine tâche Codex, utiliser :

```text
Implémente le plan de /Users/ludovicrubio/Documents/telmi/IMPLEMENTATION_PLAN.md.
Commence par l'étape 0 uniquement, avec gpt-5.6-sol en effort high.
Respecte les validations et arrête-toi au jalon avant de passer à l'étape suivante.
```
