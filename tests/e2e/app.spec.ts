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
