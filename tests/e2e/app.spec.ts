import { expect, test, type Page } from "@playwright/test";

const password = "MotDePasse-Test-2026!";

async function authenticate(page: Page) {
  await page.goto("/");
  await expect(page.locator("body")).not.toContainText("Ouverture du studio…", {
    timeout: 15_000,
  });
  if (
    await page
      .getByRole("heading", { name: "Bienvenue dans Telmi AI Studio" })
      .isVisible()
      .catch(() => false)
  ) {
    await expect(page.getByLabel("Jeton d’installation")).toHaveCount(0);
    await page.getByLabel("Mot de passe administrateur").fill(password);
    await page.getByRole("button", { name: /Installer mon studio/ }).click();
    await expect(
      page.getByRole("heading", { name: "Votre studio est prêt" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Entrer dans le studio" }).click();
  } else if (
    await page
      .getByRole("heading", { name: "Ravi de vous revoir" })
      .isVisible()
      .catch(() => false)
  ) {
    await page.getByLabel("Mot de passe").fill(password);
    await page.getByRole("button", { name: "Se connecter" }).click();
  }
  await expect(
    page.getByText("Quelle aventure allez-vous imaginer aujourd’hui ?"),
  ).toBeVisible();
}

test("installation, tableau de bord et assistant", async ({ page }) => {
  await authenticate(page);
  await page
    .getByRole("button", { name: "Créer une histoire" })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "À qui raconte-t-on cette histoire ?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Continuer/ }).click();
  await expect(
    page.getByRole("heading", { name: "Imaginons l’aventure" }),
  ).toBeVisible();
});

test("navigation vers la bibliothèque et les paramètres", async ({ page }) => {
  await authenticate(page);
  await page.getByRole("button", { name: "Bibliothèque" }).click();
  await expect(
    page.getByPlaceholder("Rechercher par titre ou description…"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Paramètres" }).click();
  await expect(
    page.getByRole("heading", { name: "Fournisseurs IA" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Exploitation" }),
  ).toBeVisible();
});

test("un brouillon peut être rouvert et modifié dans l’assistant", async ({
  page,
}) => {
  await authenticate(page);
  await page
    .getByRole("button", { name: "Créer une histoire" })
    .first()
    .click();
  for (let step = 0; step < 4; step += 1)
    await page.getByRole("button", { name: /Continuer/ }).click();
  await page.getByLabel("Description facultative").fill("Brouillon modifiable");
  await page.getByRole("button", { name: "Créer le brouillon" }).click();

  await expect(
    page.getByRole("button", { name: "Modifier la création" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Modifier la création" }).click();
  await expect(page.getByText("Modification du brouillon")).toBeVisible();
  await page.getByRole("button", { name: "2 L’aventure" }).click();
  await page.getByLabel("Titre de travail").fill("L’aventure modifiée");
  await page.getByRole("button", { name: "5 Vérification" }).click();
  await page.getByRole("button", { name: "Enregistrer le brouillon" }).click();

  await expect(
    page.getByRole("heading", { name: "L’aventure modifiée" }),
  ).toBeVisible();
});

test("les voix ElevenLabs sont proposées dans une liste déroulante", async ({
  page,
}) => {
  await page.route("**/api/providers/voices", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        list: [
          {
            voice_id: "voice-clone",
            name: "Voix de Maman",
            category: "cloned",
            preview_url: "https://example.com/preview.mp3",
            labels: { language: "en", gender: "female" },
          },
          {
            voice_id: "voice-premade",
            name: "Alice",
            category: "premade",
            labels: { language: "fr" },
          },
          {
            voice_id: "voice-english",
            name: "George",
            category: "premade",
            labels: { language: "en" },
          },
        ],
      }),
    });
  });
  await authenticate(page);
  await page
    .getByRole("button", { name: "Créer une histoire" })
    .first()
    .click();
  for (let step = 0; step < 3; step += 1)
    await page.getByRole("button", { name: /Continuer/ }).click();

  const languageSelect = page.getByLabel("Langue des voix");
  const voiceSelect = page.getByLabel("Voix ElevenLabs");
  await expect(languageSelect).toHaveValue("fr");
  await expect(voiceSelect).toBeEnabled();
  await expect(voiceSelect.locator("option")).toHaveCount(3);
  await expect(
    voiceSelect.locator('option[value="voice-english"]'),
  ).toHaveCount(0);
  await languageSelect.selectOption("en");
  await expect(
    voiceSelect.locator('option[value="voice-premade"]'),
  ).toHaveCount(0);
  await expect(
    voiceSelect.locator('option[value="voice-english"]'),
  ).toHaveCount(1);
  await voiceSelect.selectOption("voice-clone");
  await expect(page.locator("audio.voice-preview")).toBeVisible();
});

test("un dépassement de budget demande une confirmation détaillée", async ({
  page,
}) => {
  const storyId = "budget-story";
  const versionId = "11111111-1111-4111-8111-111111111111";
  const story = {
    id: storyId,
    uuid: "ffffff-budget-story",
    title: "Histoire budget",
    description: "Vérification du plafond",
    age: 4,
    versions: [
      {
        id: versionId,
        version: 1,
        status: "validated",
        parametersJson: "{}",
        estimatedCostCents: 55,
        actualCostCents: 4,
      },
    ],
    assets: [],
    latestJob: null,
  };
  const narrative = {
    schemaVersion: "1.0",
    title: story.title,
    description: story.description,
    age: 4,
    targetDurationSeconds: 120,
    startSceneId: "intro",
    scenes: [
      {
        id: "intro",
        type: "narrative",
        title: "Introduction",
        text: "Une courte introduction.",
      },
      {
        id: "fin",
        type: "ending",
        title: "Fin",
        text: "Une fin heureuse.",
      },
    ],
    choices: [
      {
        id: "suite",
        sourceSceneId: "intro",
        label: "Continuer",
        targetSceneId: "fin",
        order: 0,
      },
    ],
  };
  await page.route(/\/api\/stories(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ list: [story] }),
    });
  });
  await page.route(`**/api/stories/${storyId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(story),
    });
  });
  await page.route(
    `**/api/stories/${storyId}/versions/${versionId}/narrative`,
    async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          narrative,
          validation: { valid: true, issues: [] },
        }),
      });
    },
  );
  let overrideConfirmed = false;
  await page.route("**/api/generation-jobs", async (route) => {
    const body = route.request().postDataJSON() as {
      overrideBudget?: boolean;
    };
    if (!body.overrideBudget) {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          code: "BUDGET_EXCEEDED",
          message:
            "Le budget configuré est atteint. Une confirmation explicite est nécessaire.",
          fieldErrors: {
            budget: [
              "Estimation de la génération : 0,55 €.",
              "Total projeté pour cette histoire : 0,59 € sur un plafond de 0,50 €.",
            ],
          },
        }),
      });
      return;
    }
    overrideConfirmed = true;
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        job: {
          id: "job-budget",
          status: "queued",
          progress: 0,
          steps: [],
        },
      }),
    });
  });

  await authenticate(page);
  await page.getByRole("heading", { name: story.title }).click();
  await page
    .getByRole("button", { name: "Générer les médias & le ZIP" })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Confirmer le dépassement du budget",
    }),
  ).toBeVisible();
  await expect(page.getByText("0,59 € sur un plafond de 0,50 €")).toBeVisible();
  await page.getByRole("button", { name: "Confirmer et générer" }).click();
  await expect.poll(() => overrideConfirmed).toBe(true);
});
