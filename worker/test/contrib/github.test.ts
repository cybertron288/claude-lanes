import { test, expect } from "bun:test";
import { parseContribution, fetchContribution } from "../../src/contrib/github";
import fixture from "../fixtures/github-response.json";

test("parseContribution maps levels per week, Sunday index 0", () => {
  const weeks = parseContribution(fixture);
  expect(weeks.length).toBe(2);
  expect(weeks[0]).toEqual([0, 1, 2, 3, 4, 0, 0]);
});

test("parseContribution keeps partial weeks short", () => {
  const weeks = parseContribution(fixture);
  expect(weeks[1]).toEqual([4, 4, 3]); // only 3 days present
});

test("parseContribution throws on bad shape", () => {
  expect(() => parseContribution({ data: {} })).toThrow();
});

test("fetchContribution returns parsed weeks via injected fetch", async () => {
  const mockFetch = (async () =>
    new Response(JSON.stringify(fixture), { status: 200 })) as unknown as typeof fetch;
  const weeks = await fetchContribution("tok", "user", mockFetch);
  expect(weeks[0]).toEqual([0, 1, 2, 3, 4, 0, 0]);
});

test("fetchContribution throws on GraphQL errors payload", async () => {
  const mockFetch = (async () =>
    new Response(JSON.stringify({ errors: [{ message: "bad token" }] }), {
      status: 200,
    })) as unknown as typeof fetch;
  await expect(fetchContribution("tok", "user", mockFetch)).rejects.toThrow();
});

test("fetchContribution throws on non-200", async () => {
  const mockFetch = (async () =>
    new Response("nope", { status: 401 })) as unknown as typeof fetch;
  await expect(fetchContribution("tok", "user", mockFetch)).rejects.toThrow();
});

test("parseContribution sorts out-of-order weekdays", () => {
  const outOfOrderData = {
    data: {
      user: {
        contributionsCollection: {
          contributionCalendar: {
            weeks: [
              {
                contributionDays: [
                  { weekday: 3, "contributionLevel": "THIRD_QUARTILE" },
                  { weekday: 0, "contributionLevel": "NONE" },
                  { weekday: 6, "contributionLevel": "FOURTH_QUARTILE" },
                  { weekday: 1, "contributionLevel": "FIRST_QUARTILE" },
                ],
              },
            ],
          },
        },
      },
    },
  };
  const weeks = parseContribution(outOfOrderData);
  expect(weeks.length).toBe(1);
  // After sorting by weekday: 0=NONE, 1=FIRST_QUARTILE, 3=THIRD_QUARTILE, 6=FOURTH_QUARTILE
  // Maps to levels: 0, 1, 3, 4
  expect(weeks[0]).toEqual([0, 1, 3, 4]);
});
