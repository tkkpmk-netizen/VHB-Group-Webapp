import { expect, request, test, type APIRequestContext } from "@playwright/test";

const apiURL = "http://127.0.0.1:8100";
const password = "CommercialE2E123!";

type Identity = {
  token: string;
  workspaceId: string;
};

async function ensureIdentity(
  api: APIRequestContext,
  email: string,
): Promise<Identity> {
  const signup = await api.post("/auth/signup", {
    data: {
      email,
      password,
      full_name: "Commercial E2E",
    },
  });
  const tokenResponse =
    signup.status() === 409
      ? await api.post("/auth/login", { data: { email, password } })
      : signup;
  expect(
    tokenResponse.ok(),
    `Identity seed failed (${tokenResponse.status()}): ${await tokenResponse.text()}`,
  ).toBeTruthy();
  const { access_token: token } = (await tokenResponse.json()) as {
    access_token: string;
  };
  const workspaces = await api.get("/workspaces", {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(workspaces.ok()).toBeTruthy();
  const memberships = (await workspaces.json()) as Array<{ id: string }>;
  return { token, workspaceId: memberships[0].id };
}

test.describe("Commercial Foundation shell", () => {
  let api: APIRequestContext;
  let owner: Identity;
  let outsider: Identity;

  test.beforeAll(async () => {
    api = await request.newContext({ baseURL: apiURL });
    owner = await ensureIdentity(api, "commercial-shell-owner@example.com");
    outsider = await ensureIdentity(api, "commercial-shell-outsider@example.com");
  });

  test.afterAll(async () => {
    await api.dispose();
  });

  test("login restores the authorized shell and stable destination route", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await page.goto("/login");
    await page.getByPlaceholder("Email").fill("commercial-shell-owner@example.com");
    await page.getByPlaceholder("Mật khẩu (≥ 8 ký tự)").fill(password);
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await expect(page).toHaveURL("/");

    await page
      .getByRole("link", { name: "Database", exact: true })
      .first()
      .click();
    await expect(page).toHaveURL("/databases");
    await expect(
      page.getByRole("heading", { name: "Database", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Space Management", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Open sidebar")).toHaveCount(0);
    await page
      .getByRole("button", { name: "New database", exact: true })
      .first()
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();

    await page.goto("/commercial-data");
    await expect(page).toHaveURL("/commercial-data/quality");
    await expect(
      page.getByRole("heading", { name: "Quality Control" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Quality Control" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await page.getByRole("link", { name: "Products", exact: true }).click();
    await expect(page).toHaveURL("/products");
    await expect(
      page.getByRole("heading", { name: "Products", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Import database")).toBeVisible();
    await expect(page.getByTitle("Add layout")).toBeVisible();
    await expect(page.getByLabel("Open sidebar")).toHaveCount(0);
    const infoBar = page.getByRole("complementary", {
      name: "Record information and audit history",
    });
    await expect(infoBar).toBeVisible();
    await expect(infoBar.getByRole("heading", { name: "Audit history" })).toBeVisible();
    const infoToggle = page.getByRole("button", { name: "Info", exact: true });
    await infoToggle.click();
    await expect(infoBar).toBeHidden();
    await infoToggle.click();
    await expect(infoBar).toBeVisible();

    const widthBefore = (await infoBar.boundingBox())?.width ?? 0;
    const resizeHandle = infoBar.getByRole("button", {
      name: "Resize information panel",
    });
    await resizeHandle.focus();
    await resizeHandle.press("ArrowLeft");
    expect((await infoBar.boundingBox())?.width ?? 0).toBeGreaterThan(widthBefore);

    const productName = `E2E Product ${Date.now()}`;
    await page.getByRole("button", { name: /^New/ }).click();
    await page.getByRole("textbox", { name: "Entity name" }).fill(productName);
    await page.getByRole("button", { name: "Create entity" }).click();
    const productRow = page.getByRole("row", { name: new RegExp(productName) });
    await expect(productRow).toBeVisible();
    await productRow.getByRole("checkbox").check();
    await expect(infoBar.getByText(productName, { exact: true }).first()).toBeVisible();
    await expect(infoBar.getByText("Properties · 8", { exact: true })).toBeVisible();
    await expect(infoBar.getByText(`Created entity "${productName}"`)).toBeVisible({
      timeout: 10_000,
    });
    await productRow.getByRole("checkbox").uncheck();

    const secondProductName = `E2E Secondary Product ${Date.now()}`;
    await page.getByRole("button", { name: /^New/ }).click();
    await page.getByRole("textbox", { name: "Entity name" }).fill(secondProductName);
    await page.getByRole("button", { name: "Create entity" }).click();
    const secondProductRow = page.getByRole("row", {
      name: new RegExp(secondProductName),
    });
    await expect(secondProductRow).toBeVisible();
    await expect(
      infoBar.getByText(`Created entity "${secondProductName}"`),
    ).toHaveCount(0);

    await productRow.getByRole("checkbox").check();
    await secondProductRow.getByRole("checkbox").check();
    const selectionActions = page.getByRole("button", { name: "2 selected" });
    await expect(selectionActions).toBeVisible();
    await selectionActions.click();
    await expect(page.getByRole("menuitem", { name: /Create Inquiry/ })).toBeDisabled();
    await page.getByRole("menuitem", { name: "Create Order List" }).click();
    await expect(page).toHaveURL("/order-management?tab=render&source=products");
    await expect(page.locator(`input[value="${productName}"]`)).toBeVisible();
    await expect(page.locator(`input[value="${secondProductName}"]`)).toBeVisible();

    await page.goto("/products");
    await expect(page.getByRole("heading", { name: "Products", exact: true })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(infoBar).toBeHidden();
    await page.getByRole("button", { name: "Info", exact: true }).click();
    await expect(infoBar).toBeVisible();
    await infoBar.getByRole("button", { name: "Close information panel" }).click();
    await expect(infoBar).toBeHidden();
    await page.setViewportSize({ width: 1280, height: 720 });

    await page.getByTitle("Add column").click();
    await expect(page.getByText("New column", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();

    for (const catalog of ["Customers", "Suppliers"]) {
      await page.getByRole("link", { name: catalog, exact: true }).click();
      await expect(page).toHaveURL(`/${catalog.toLowerCase()}`);
      await expect(
        page.getByRole("heading", { name: catalog, exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel("Import database")).toBeVisible();
    }

    await page.getByRole("link", { name: "Orders", exact: true }).click();
    await expect(page).toHaveURL("/order-management");
    await expect(
      page.getByRole("heading", { name: "Order Management", exact: true }),
    ).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });

  test("an authenticated outsider cannot infer another workspace", async () => {
    const response = await api.get("/commercial/bootstrap", {
      headers: {
        Authorization: `Bearer ${outsider.token}`,
        "X-Workspace-ID": owner.workspaceId,
      },
    });
    expect(response.status()).toBe(404);
    expect(await response.json()).toEqual({ detail: "Workspace not found" });
  });
});
