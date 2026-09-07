import { describe, it, expect } from "vitest";
import { normalizeHeader, lookupAlias } from "./aliases.js";

describe("normalizeHeader", () => {
  it("lowercases", () => {
    expect(normalizeHeader("SKU")).toBe("sku");
  });

  it("trims", () => {
    expect(normalizeHeader("  SKU  ")).toBe("sku");
  });

  it("collapses whitespace", () => {
    expect(normalizeHeader("Product   Name")).toBe("product name");
  });

  it("removes trailing periods", () => {
    expect(normalizeHeader("Item No.")).toBe("item no");
  });
});

describe("lookupAlias", () => {
  it("matches exact alias", () => {
    expect(lookupAlias("SKU")).toEqual({ target: "variant.sku" });
  });

  it("matches case-insensitive", () => {
    expect(lookupAlias("Product Name")).toEqual({ target: "product.title" });
  });

  it("matches with extra whitespace", () => {
    expect(lookupAlias("  Item   Number  ")).toEqual({ target: "variant.sku" });
  });

  it("matches trailing period: Item No.", () => {
    expect(lookupAlias("Item No.")).toEqual({ target: "variant.sku" });
  });

  it("returns null for unknown header", () => {
    expect(lookupAlias("Xylophone Rating")).toBeNull();
  });

  it("matches numbered image columns", () => {
    const result = lookupAlias("Image 2");
    expect(result).toEqual({ target: "image.url", imagePosition: 2 });
  });

  it("matches numbered image without space", () => {
    const result = lookupAlias("image3");
    expect(result).toEqual({ target: "image.url", imagePosition: 3 });
  });

  it("matches Photo as image", () => {
    expect(lookupAlias("Photo 5")).toEqual({
      target: "image.url",
      imagePosition: 5,
    });
  });

  it("maps common price aliases", () => {
    expect(lookupAlias("Retail Price")).toEqual({ target: "variant.price" });
    expect(lookupAlias("MSRP")).toEqual({ target: "variant.price" });
    expect(lookupAlias("RRP")).toEqual({ target: "variant.price" });
  });

  it("maps cost aliases", () => {
    expect(lookupAlias("Wholesale")).toEqual({ target: "variant.cost" });
    expect(lookupAlias("Cost Price")).toEqual({ target: "variant.cost" });
    expect(lookupAlias("Net Price")).toEqual({ target: "variant.cost" });
  });

  it("maps barcode aliases", () => {
    expect(lookupAlias("UPC")).toEqual({ target: "variant.barcode" });
    expect(lookupAlias("EAN")).toEqual({ target: "variant.barcode" });
    expect(lookupAlias("GTIN")).toEqual({ target: "variant.barcode" });
  });

  it("maps grouping aliases", () => {
    expect(lookupAlias("Parent SKU")).toEqual({ target: "grouping.parentKey" });
    expect(lookupAlias("Group ID")).toEqual({ target: "grouping.parentKey" });
  });

  // --- Shopify-native CSV columns ---

  describe("Shopify-native columns", () => {
    it("maps Handle to grouping key", () => {
      expect(lookupAlias("Handle")).toEqual({ target: "grouping.parentKey" });
    });

    it("maps Body (HTML)", () => {
      expect(lookupAlias("Body (HTML)")).toEqual({ target: "product.description" });
    });

    it("maps Variant SKU", () => {
      expect(lookupAlias("Variant SKU")).toEqual({ target: "variant.sku" });
    });

    it("maps Variant Price", () => {
      expect(lookupAlias("Variant Price")).toEqual({ target: "variant.price" });
    });

    it("maps Variant Compare At Price", () => {
      expect(lookupAlias("Variant Compare At Price")).toEqual({ target: "variant.compareAtPrice" });
    });

    it("maps Variant Barcode", () => {
      expect(lookupAlias("Variant Barcode")).toEqual({ target: "variant.barcode" });
    });

    it("maps Variant Grams to weight", () => {
      expect(lookupAlias("Variant Grams")).toEqual({ target: "variant.weight" });
    });

    it("maps Variant Weight Unit", () => {
      expect(lookupAlias("Variant Weight Unit")).toEqual({ target: "variant.weightUnit" });
    });

    it("maps Variant Inventory Qty", () => {
      expect(lookupAlias("Variant Inventory Qty")).toEqual({ target: "variant.inventoryQuantity" });
    });

    it("maps Image Src", () => {
      expect(lookupAlias("Image Src")).toEqual({ target: "image.url" });
    });

    it("maps Image Alt Text", () => {
      expect(lookupAlias("Image Alt Text")).toEqual({ target: "image.altText" });
    });

    it("maps Variant Image to image.url", () => {
      expect(lookupAlias("Variant Image")).toEqual({ target: "image.url" });
    });

    it("maps Option1-3 Value to variant options", () => {
      expect(lookupAlias("Option1 Value")).toEqual({ target: "variant.option1" });
      expect(lookupAlias("Option2 Value")).toEqual({ target: "variant.option2" });
      expect(lookupAlias("Option3 Value")).toEqual({ target: "variant.option3" });
    });

    it("maps Option1-3 Name to ignore", () => {
      expect(lookupAlias("Option1 Name")).toEqual({ target: "ignore" });
      expect(lookupAlias("Option2 Name")).toEqual({ target: "ignore" });
      expect(lookupAlias("Option3 Name")).toEqual({ target: "ignore" });
    });

    it("maps Shopify metadata columns to ignore", () => {
      expect(lookupAlias("Published")).toEqual({ target: "ignore" });
      expect(lookupAlias("Variant Inventory Tracker")).toEqual({ target: "ignore" });
      expect(lookupAlias("Variant Taxable")).toEqual({ target: "ignore" });
      expect(lookupAlias("Gift Card")).toEqual({ target: "ignore" });
      expect(lookupAlias("SEO Title")).toEqual({ target: "ignore" });
      expect(lookupAlias("Google Shopping / Gender")).toEqual({ target: "ignore" });
    });
  });

  // --- German aliases ---

  describe("German aliases", () => {
    it("maps Artikelnummer to SKU", () => {
      expect(lookupAlias("Artikelnummer")).toEqual({ target: "variant.sku" });
    });

    it("maps Produktname to title", () => {
      expect(lookupAlias("Produktname")).toEqual({ target: "product.title" });
    });

    it("maps Beschreibung to description", () => {
      expect(lookupAlias("Beschreibung")).toEqual({ target: "product.description" });
    });

    it("maps Marke to vendor", () => {
      expect(lookupAlias("Marke")).toEqual({ target: "product.vendor" });
    });

    it("maps Kategorie to productType", () => {
      expect(lookupAlias("Kategorie")).toEqual({ target: "product.productType" });
    });

    it("maps Preis (EUR) to price", () => {
      expect(lookupAlias("Preis (EUR)")).toEqual({ target: "variant.price" });
    });

    it("maps UVP (EUR) to compareAtPrice", () => {
      expect(lookupAlias("UVP (EUR)")).toEqual({ target: "variant.compareAtPrice" });
    });

    it("maps Einkaufspreis to cost", () => {
      expect(lookupAlias("Einkaufspreis")).toEqual({ target: "variant.cost" });
    });

    it("maps Menge to inventory quantity", () => {
      expect(lookupAlias("Menge")).toEqual({ target: "variant.inventoryQuantity" });
    });

    it("maps Gewicht (kg) to weight", () => {
      expect(lookupAlias("Gewicht (kg)")).toEqual({ target: "variant.weight" });
    });

    it("maps Bild URL to image", () => {
      expect(lookupAlias("Bild URL")).toEqual({ target: "image.url" });
    });
  });

  // --- French aliases ---

  describe("French aliases", () => {
    it("maps Désignation to title", () => {
      expect(lookupAlias("Désignation")).toEqual({ target: "product.title" });
    });

    it("maps Designation (no accent) to title", () => {
      expect(lookupAlias("Designation")).toEqual({ target: "product.title" });
    });

    it("maps Fournisseur to vendor", () => {
      expect(lookupAlias("Fournisseur")).toEqual({ target: "product.vendor" });
    });

    it("maps PVP to price", () => {
      expect(lookupAlias("PVP")).toEqual({ target: "variant.price" });
    });

    it("maps Tarif to cost", () => {
      expect(lookupAlias("Tarif")).toEqual({ target: "variant.cost" });
    });

    it("maps Stock Dispo to inventory", () => {
      expect(lookupAlias("Stock Dispo")).toEqual({ target: "variant.inventoryQuantity" });
    });

    it("maps Lien Photo to image", () => {
      expect(lookupAlias("Lien Photo")).toEqual({ target: "image.url" });
    });

    it("maps Conditionnement to ignore", () => {
      expect(lookupAlias("Conditionnement")).toEqual({ target: "ignore" });
    });

    it("maps Ref Code to SKU", () => {
      expect(lookupAlias("Ref Code")).toEqual({ target: "variant.sku" });
    });
  });

  // --- Spanish aliases ---

  describe("Spanish aliases", () => {
    it("maps Nombre to title", () => {
      expect(lookupAlias("Nombre")).toEqual({ target: "product.title" });
    });

    it("maps Nombre del Producto to title", () => {
      expect(lookupAlias("Nombre del Producto")).toEqual({ target: "product.title" });
    });

    it("maps Marca to vendor", () => {
      expect(lookupAlias("Marca")).toEqual({ target: "product.vendor" });
    });

    it("maps Precio to price", () => {
      expect(lookupAlias("Precio")).toEqual({ target: "variant.price" });
    });

    it("maps Cantidad to inventory", () => {
      expect(lookupAlias("Cantidad")).toEqual({ target: "variant.inventoryQuantity" });
    });

    it("maps Imagen to image", () => {
      expect(lookupAlias("Imagen")).toEqual({ target: "image.url" });
    });

    it("maps Código to SKU", () => {
      expect(lookupAlias("Código")).toEqual({ target: "variant.sku" });
    });

    it("maps Codigo (no accent) to SKU", () => {
      expect(lookupAlias("Codigo")).toEqual({ target: "variant.sku" });
    });

    it("maps Categoría to productType", () => {
      expect(lookupAlias("Categoría")).toEqual({ target: "product.productType" });
    });
  });

  // --- Industrial / B2B aliases ---

  describe("Industrial / B2B aliases", () => {
    it("maps Part Number to SKU", () => {
      expect(lookupAlias("Part Number")).toEqual({ target: "variant.sku" });
    });

    it("maps Item ID to SKU", () => {
      expect(lookupAlias("Item ID")).toEqual({ target: "variant.sku" });
    });

    it("maps Country of Origin to ignore", () => {
      expect(lookupAlias("Country of Origin")).toEqual({ target: "ignore" });
    });
  });
});
