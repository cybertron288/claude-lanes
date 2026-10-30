const LEVEL_MAP: Record<string, number> = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

const QUERY = `
query($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        weeks {
          contributionDays { weekday contributionLevel }
        }
      }
    }
  }
}`;

export function parseContribution(json: unknown): number[][] {
  const weeks = (json as any)?.data?.user?.contributionsCollection
    ?.contributionCalendar?.weeks;
  if (!Array.isArray(weeks)) {
    throw new Error("Unexpected GraphQL shape: weeks missing");
  }
  return weeks.map((w: any) => {
    const days = w?.contributionDays;
    if (!Array.isArray(days)) throw new Error("Unexpected week shape");
    // Order by weekday (0=Sunday) so index 0 is Sunday.
    const sorted = [...days].sort((a, b) => a.weekday - b.weekday);
    return sorted.map((d: any) => LEVEL_MAP[d.contributionLevel] ?? 0);
  });
}

export async function fetchContribution(
  token: string,
  username: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number[][]> {
  const res = await fetchImpl("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "github-contribution-led",
    },
    body: JSON.stringify({ query: QUERY, variables: { login: username } }),
  });
  if (!res.ok) {
    throw new Error(`GitHub HTTP ${res.status}`);
  }
  const json = await res.json();
  if ((json as any).errors) {
    throw new Error(`GitHub GraphQL error: ${JSON.stringify((json as any).errors)}`);
  }
  return parseContribution(json);
}
