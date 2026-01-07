# Elderwood - Nakama Backend pour MMO Harry Potter

Backend de jeu multijoueur basé sur [Nakama](https://heroiclabs.com/nakama/) pour un MMO inspiré de l'univers Harry Potter sous Unreal Engine.

## Table des matières

- [Fonctionnalités](#fonctionnalités)
- [Prérequis](#prérequis)
- [Installation](#installation)
- [Lancement](#lancement)
- [Architecture](#architecture)
- [API Reference](#api-reference)
- [Exemples d'utilisation](#exemples-dutilisation)
- [Intégration Unreal Engine](#intégration-unreal-engine)

---

## Fonctionnalités

### Système de personnages
- Création/suppression de personnages (max 5 par compte)
- Attributs : nom, niveau, XP, maison
- Stockage persistant par compte utilisateur

### Système de maisons
- 4 maisons : **Venatrix**, **Falcon**, **Brumval**, **Aerwyn**
- Maison par défaut : "Pas de Maison"
- Points de maison avec historique
- Classement en temps réel

### Système d'inventaire
- 27 objets prédéfinis (baguettes, potions, ingrédients, livres, équipements...)
- 5 niveaux de rareté (commun → légendaire)
- Gestion des quantités et stacks

### Système de sorts
- 35 sorts prédéfinis (enchantements, métamorphose, défense, maléfices...)
- 4 niveaux de difficulté
- Maîtrise des sorts (niveau 0 à 3)
- Prérequis de niveau pour apprendre

### Système de carnets de notes
- 15 matières scolaires (Potions, Défense contre les forces du mal, etc.)
- Carnets personnalisables (titre, contenu, matière)
- Stockage illimité par personnage

### Panneau d'administration
- Interface web Angular + PrimeNG
- Gestion des points de maison
- Gestion des personnages, sorts et inventaires
- Authentification par rôle (admin/modérateur)

---

## Prérequis

- **Docker** et **Docker Compose** (recommandé)
- Ou : **Go 1.21+**, **CockroachDB** ou **PostgreSQL**
- **Node.js 18+** (pour le panneau admin)

---

## Installation

### 1. Cloner le repository

```bash
git clone https://github.com/votre-repo/elderwood-nakama.git
cd elderwood-nakama
```

### 2. Configuration

Copier le fichier de configuration exemple :

```bash
cp data/local.yml.example data/local.yml
```

Contenu de `data/local.yml` :
```yaml
name: elderwood-local
data_dir: "./data/"

logger:
  level: "DEBUG"
  stdout: true

session:
  token_expiry_sec: 604800  # 7 jours

runtime:
  path: "./data/modules"

console:
  username: "admin"
  password: "password"
```

### 3. Installer les dépendances du panneau admin

```bash
cd admin-panel
npm install
cd ..
```

---

## Lancement

### Option A : Avec Docker (Recommandé)

Créer un fichier `docker-compose.yml` :

```yaml
version: '3.8'
services:
  cockroachdb:
    image: cockroachdb/cockroach:latest-v23.1
    command: start-single-node --insecure --store=attrs=ssd,path=/var/lib/cockroach/
    volumes:
      - cockroach-data:/var/lib/cockroach
    ports:
      - "26257:26257"
      - "8080:8080"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health?ready=1"]
      interval: 10s
      timeout: 5s
      retries: 5

  nakama:
    image: heroiclabs/nakama:3.21.1
    entrypoint:
      - "/bin/sh"
      - "-ecx"
      - >
        /nakama/nakama migrate up --database.address root@cockroachdb:26257 &&
        exec /nakama/nakama --config /nakama/data/local.yml --database.address root@cockroachdb:26257
    depends_on:
      cockroachdb:
        condition: service_healthy
    volumes:
      - ./data:/nakama/data
    ports:
      - "7350:7350"   # API HTTP/gRPC
      - "7351:7351"   # Console Admin Nakama
      - "7349:7349"   # gRPC
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:7350/"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  cockroach-data:
```

Lancer les services :

```bash
# Démarrer Nakama + CockroachDB
docker-compose up -d

# Voir les logs
docker-compose logs -f nakama
```

### Option B : Sans Docker

```bash
# 1. Démarrer CockroachDB
cockroach start-single-node --insecure --listen-addr=localhost:26257

# 2. Appliquer les migrations
./nakama migrate up --database.address "root@localhost:26257"

# 3. Démarrer Nakama
./nakama --config ./data/local.yml --database.address "root@localhost:26257"
```

### Lancer le panneau d'administration

```bash
cd admin-panel
npm start
```

Le panneau sera accessible sur **http://localhost:4200**

### URLs des services

| Service | URL | Description |
|---------|-----|-------------|
| API Nakama | http://localhost:7350 | API REST/gRPC |
| Console Nakama | http://localhost:7351 | Console admin intégrée |
| Panneau Admin | http://localhost:4200 | Interface Angular |

---

## Architecture

```
elderwood-nakama/
├── data/
│   ├── modules/
│   │   └── elderwood_characters.go   # Module Go principal
│   ├── local.yml                     # Configuration locale
│   └── local.yml.example             # Exemple de configuration
├── admin-panel/                      # Frontend Angular
│   ├── src/
│   │   ├── app/
│   │   │   ├── components/          # Composants UI
│   │   │   ├── services/            # Services API
│   │   │   └── models/              # Types TypeScript
│   │   └── environments/            # Configuration
│   └── package.json
└── docker-compose.yml
```

### Collections de stockage Nakama

| Collection | Description |
|------------|-------------|
| `characters` | Personnages des joueurs |
| `house_scores` | Scores des maisons |
| `house_points_history` | Historique des points |
| `inventories` | Inventaires des personnages |
| `character_spells` | Sorts appris |
| `notebooks` | Carnets de notes |

---

## API Reference

### RPCs disponibles

#### Personnages

| RPC | Description | Payload |
|-----|-------------|---------|
| `elderwood_create_character` | Créer un personnage | `{ "name": "Harry" }` |
| `elderwood_get_characters` | Liste des personnages | `{}` |
| `elderwood_get_character` | Obtenir un personnage | `{ "id": "uuid" }` |
| `elderwood_update_character` | Modifier un personnage | `{ "id": "uuid", "level": 5 }` |
| `elderwood_delete_character` | Supprimer un personnage | `{ "id": "uuid" }` |

#### Maisons

| RPC | Description | Payload |
|-----|-------------|---------|
| `elderwood_get_house_rankings` | Classement des maisons | `{}` |
| `elderwood_get_house_points_history` | Historique des points | `{ "house": "Venatrix", "limit": 50 }` |
| `elderwood_modify_house_points` | Ajouter/retirer des points | `{ "house": "Falcon", "points": 10, "reason": "..." }` |

#### Inventaire

| RPC | Description | Payload |
|-----|-------------|---------|
| `elderwood_get_items_catalog` | Catalogue des objets | `{ "category": "potion" }` |
| `elderwood_get_inventory` | Inventaire d'un personnage | `{ "character_id": "uuid" }` |
| `elderwood_add_item` | Ajouter un objet | `{ "character_id": "uuid", "item_id": "potion_health", "quantity": 5 }` |
| `elderwood_remove_item` | Retirer un objet | `{ "character_id": "uuid", "item_id": "potion_health", "quantity": 1 }` |

#### Sorts

| RPC | Description | Payload |
|-----|-------------|---------|
| `elderwood_get_spells_catalog` | Catalogue des sorts | `{ "category": "charm" }` |
| `elderwood_get_character_spells` | Sorts d'un personnage | `{ "character_id": "uuid" }` |
| `elderwood_learn_spell` | Apprendre un sort | `{ "character_id": "uuid", "spell_id": "spell_lumos" }` |
| `elderwood_upgrade_spell` | Améliorer un sort | `{ "character_id": "uuid", "spell_id": "spell_lumos" }` |
| `elderwood_forget_spell` | Oublier un sort | `{ "character_id": "uuid", "spell_id": "spell_lumos" }` |

#### Carnets de notes

| RPC | Description | Payload |
|-----|-------------|---------|
| `elderwood_get_subjects` | Liste des matières | `{}` |
| `elderwood_create_notebook` | Créer un carnet | `{ "character_id": "uuid", "title": "...", "subject": "Potions", "content": "..." }` |
| `elderwood_get_notebooks` | Carnets d'un personnage | `{ "character_id": "uuid", "subject": "Potions" }` |
| `elderwood_get_notebook` | Obtenir un carnet | `{ "character_id": "uuid", "notebook_id": "uuid" }` |
| `elderwood_update_notebook` | Modifier un carnet | `{ "character_id": "uuid", "notebook_id": "uuid", "content": "..." }` |
| `elderwood_delete_notebook` | Supprimer un carnet | `{ "character_id": "uuid", "notebook_id": "uuid" }` |

---

## Exemples d'utilisation

### Authentification (curl)

```bash
# Créer un compte / Se connecter
curl -X POST "http://localhost:7350/v2/account/authenticate/email?create=true" \
  -H "Authorization: Basic ZGVmYXVsdGtleTo=" \
  -H "Content-Type: application/json" \
  -d '{"email": "player@elderwood.com", "password": "password123"}'
```

Réponse :
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "..."
}
```

### Appel RPC (curl)

```bash
# Créer un personnage
curl -X POST "http://localhost:7350/v2/rpc/elderwood_create_character" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..." \
  -H "Content-Type: application/json" \
  -d '{"payload": "{\"name\": \"Hermione\"}"}'
```

Réponse :
```json
{
  "payload": "{\"id\":\"abc-123\",\"name\":\"Hermione\",\"house\":\"Pas de Maison\",\"level\":1,\"xp\":0}"
}
```

### Exemple Frontend Angular

```typescript
// services/nakama.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class NakamaService {
  private baseUrl = 'http://localhost:7350';

  constructor(private http: HttpClient) {}

  // Appel RPC générique
  private rpc<T>(id: string, payload: object = {}): Observable<T> {
    return this.http.post<{ payload: string }>(`${this.baseUrl}/v2/rpc/${id}`, {
      payload: JSON.stringify(payload)
    }).pipe(
      map(response => JSON.parse(response.payload) as T)
    );
  }

  // Créer un personnage
  createCharacter(name: string): Observable<Character> {
    return this.rpc<Character>('elderwood_create_character', { name });
  }

  // Obtenir l'inventaire
  getInventory(characterId: string): Observable<InventoryResponse> {
    return this.rpc<InventoryResponse>('elderwood_get_inventory', {
      character_id: characterId
    });
  }

  // Apprendre un sort
  learnSpell(characterId: string, spellId: string): Observable<any> {
    return this.rpc('elderwood_learn_spell', {
      character_id: characterId,
      spell_id: spellId
    });
  }
}
```

---

## Intégration Unreal Engine

### Étape 1 : Installer le plugin Nakama

1. Télécharger le plugin depuis [heroiclabs/nakama-unreal](https://github.com/heroiclabs/nakama-unreal)
2. Copier dans `YourProject/Plugins/Nakama`
3. Ajouter dans `YourProject.Build.cs` :
   ```csharp
   PublicDependencyModuleNames.AddRange(new string[] { "Nakama" });
   ```
4. Régénérer les fichiers projet

### Étape 2 : Configuration de la connexion

```cpp
// GameInstance.h
#pragma once
#include "CoreMinimal.h"
#include "Engine/GameInstance.h"
#include "NakamaClient.h"
#include "ElderWoodGameInstance.generated.h"

UCLASS()
class ELDERWOOD_API UElderWoodGameInstance : public UGameInstance
{
    GENERATED_BODY()

public:
    virtual void Init() override;

    UPROPERTY()
    UNakamaClient* NakamaClient;

    UPROPERTY()
    UNakamaSession* CurrentSession;

    // Authentification
    UFUNCTION(BlueprintCallable)
    void AuthenticateWithEmail(const FString& Email, const FString& Password);

    // RPC
    UFUNCTION(BlueprintCallable)
    void CreateCharacter(const FString& CharacterName);

    UFUNCTION(BlueprintCallable)
    void GetCharacters();

    UFUNCTION(BlueprintCallable)
    void LearnSpell(const FString& CharacterId, const FString& SpellId);
};
```

### Étape 3 : Implémentation

```cpp
// GameInstance.cpp
#include "ElderWoodGameInstance.h"

void UElderWoodGameInstance::Init()
{
    Super::Init();

    // Créer le client Nakama
    NakamaClient = UNakamaClient::CreateDefaultClient(
        "defaultkey",           // Server Key
        "127.0.0.1",           // Host
        7350,                   // Port
        false                   // SSL
    );
}

void UElderWoodGameInstance::AuthenticateWithEmail(const FString& Email, const FString& Password)
{
    auto OnSuccess = [this](UNakamaSession* Session)
    {
        CurrentSession = Session;
        UE_LOG(LogTemp, Log, TEXT("Authentifié! Token: %s"), *Session->AuthToken);

        // Charger les personnages après connexion
        GetCharacters();
    };

    auto OnError = [](const FNakamaError& Error)
    {
        UE_LOG(LogTemp, Error, TEXT("Erreur auth: %s"), *Error.Message);
    };

    NakamaClient->AuthenticateEmail(
        Email,
        Password,
        TEXT(""),   // Username (optionnel)
        true,       // Create account if not exists
        {},         // Vars
        OnSuccess,
        OnError
    );
}

void UElderWoodGameInstance::CreateCharacter(const FString& CharacterName)
{
    if (!CurrentSession) return;

    // Construire le payload JSON
    TSharedPtr<FJsonObject> Payload = MakeShareable(new FJsonObject);
    Payload->SetStringField("name", CharacterName);

    FString PayloadString;
    TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&PayloadString);
    FJsonSerializer::Serialize(Payload.ToSharedRef(), Writer);

    auto OnSuccess = [](const FNakamaRPC& Response)
    {
        UE_LOG(LogTemp, Log, TEXT("Personnage créé: %s"), *Response.Payload);

        // Parser la réponse JSON
        TSharedPtr<FJsonObject> JsonObject;
        TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Response.Payload);
        if (FJsonSerializer::Deserialize(Reader, JsonObject))
        {
            FString CharId = JsonObject->GetStringField("id");
            FString CharName = JsonObject->GetStringField("name");
            int32 Level = JsonObject->GetIntegerField("level");
            // Utiliser les données...
        }
    };

    auto OnError = [](const FNakamaError& Error)
    {
        UE_LOG(LogTemp, Error, TEXT("Erreur création: %s"), *Error.Message);
    };

    NakamaClient->RPC(
        CurrentSession,
        "elderwood_create_character",
        PayloadString,
        OnSuccess,
        OnError
    );
}

void UElderWoodGameInstance::GetCharacters()
{
    if (!CurrentSession) return;

    auto OnSuccess = [](const FNakamaRPC& Response)
    {
        UE_LOG(LogTemp, Log, TEXT("Personnages: %s"), *Response.Payload);

        TSharedPtr<FJsonObject> JsonObject;
        TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Response.Payload);
        if (FJsonSerializer::Deserialize(Reader, JsonObject))
        {
            const TArray<TSharedPtr<FJsonValue>>* Characters;
            if (JsonObject->TryGetArrayField("characters", Characters))
            {
                for (const auto& CharValue : *Characters)
                {
                    TSharedPtr<FJsonObject> CharObj = CharValue->AsObject();
                    FString Name = CharObj->GetStringField("name");
                    FString House = CharObj->GetStringField("house");
                    int32 Level = CharObj->GetIntegerField("level");

                    UE_LOG(LogTemp, Log, TEXT("- %s (%s) Niv.%d"), *Name, *House, Level);
                }
            }
        }
    };

    NakamaClient->RPC(
        CurrentSession,
        "elderwood_get_characters",
        "{}",
        OnSuccess,
        {} // OnError
    );
}

void UElderWoodGameInstance::LearnSpell(const FString& CharacterId, const FString& SpellId)
{
    if (!CurrentSession) return;

    TSharedPtr<FJsonObject> Payload = MakeShareable(new FJsonObject);
    Payload->SetStringField("character_id", CharacterId);
    Payload->SetStringField("spell_id", SpellId);

    FString PayloadString;
    TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&PayloadString);
    FJsonSerializer::Serialize(Payload.ToSharedRef(), Writer);

    auto OnSuccess = [SpellId](const FNakamaRPC& Response)
    {
        UE_LOG(LogTemp, Log, TEXT("Sort %s appris!"), *SpellId);
    };

    NakamaClient->RPC(
        CurrentSession,
        "elderwood_learn_spell",
        PayloadString,
        OnSuccess,
        {}
    );
}
```

### Étape 4 : Utilisation dans les Blueprints

1. Dans votre Blueprint de menu :
   - Obtenir `Game Instance` → Cast to `ElderWoodGameInstance`
   - Appeler `AuthenticateWithEmail` avec les champs de saisie

2. Créer des événements personnalisés pour les callbacks :
   ```
   Event OnCharactersLoaded (Characters: Array of CharacterStruct)
   Event OnSpellLearned (SpellName: String)
   ```

### Étape 5 : Structures de données

```cpp
// ElderWoodTypes.h
#pragma once

#include "CoreMinimal.h"
#include "ElderWoodTypes.generated.h"

USTRUCT(BlueprintType)
struct FElderWoodCharacter
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly)
    FString Id;

    UPROPERTY(BlueprintReadOnly)
    FString Name;

    UPROPERTY(BlueprintReadOnly)
    FString House;

    UPROPERTY(BlueprintReadOnly)
    int32 Level;

    UPROPERTY(BlueprintReadOnly)
    int64 XP;
};

USTRUCT(BlueprintType)
struct FElderWoodSpell
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly)
    FString SpellId;

    UPROPERTY(BlueprintReadOnly)
    FString Name;

    UPROPERTY(BlueprintReadOnly)
    FString Incantation;

    UPROPERTY(BlueprintReadOnly)
    int32 Level;  // 0-3
};

USTRUCT(BlueprintType)
struct FElderWoodInventoryItem
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly)
    FString ItemId;

    UPROPERTY(BlueprintReadOnly)
    FString Name;

    UPROPERTY(BlueprintReadOnly)
    int32 Quantity;
};
```

---

## Licence

Ce projet est basé sur Nakama (Apache-2.0). Les modules Elderwood sont également sous licence Apache-2.0.
