// Netlify Function: secure proxy to API-Football.
// Keeps the API key server-side (as a Netlify environment variable),
// fetches the full World Cup 2026 fixture list, and returns a slim
// JSON array the client-side bracket page can consume safely.

exports.handler = async function (event, context) {
  const API_KEY = process.env.API_FOOTBALL_KEY;

  if (!API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "API_FOOTBALL_KEY environment variable is not set on Netlify." }),
    };
  }

  try {
    const res = await fetch(
      "https://v3.football.api-sports.io/fixtures?league=1&season=2026",
      { headers: { "x-apisports-key": API_KEY } }
    );

    if (!res.ok) {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: `API-Football returned ${res.status}` }),
      };
    }

    const data = await res.json();

    // TEMP DEBUG: surface API-Football's own diagnostics so we can see why
    // the fixture list might be empty (bad key, wrong plan, rate limit, etc).
    if (event.queryStringParameters && event.queryStringParameters.debug) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          errors: data.errors,
          results: data.results,
          paging: data.paging,
          parameters: data.parameters,
          sampleFirstFixture: (data.response || [])[0] || null,
        }),
      };
    }

    const fixtures = (data.response || [])
      // Only knockout-stage rounds - drop the 72 group-stage games to keep the payload small.
      .filter((f) => {
        const round = (f.league && f.league.round) || "";
        return !/group/i.test(round);
      })
      .map((f) => {
        const home = f.teams.home.name;
        const away = f.teams.away.name;
        const goalsHome = f.goals.home;
        const goalsAway = f.goals.away;
        const pen = f.score && f.score.penalty ? f.score.penalty : null;
        return {
          id: f.fixture.id,
          round: f.league.round,
          date: f.fixture.date,
          statusShort: f.fixture.status.short, // NS, 1H, HT, 2H, ET, PEN, FT, AET, PEN
          statusLong: f.fixture.status.long,
          elapsed: f.fixture.status.elapsed,
          venueName: (f.fixture.venue && f.fixture.venue.name) || null,
          venueCity: (f.fixture.venue && f.fixture.venue.city) || null,
          home,
          away,
          homeGoals: goalsHome,
          awayGoals: goalsAway,
          homePen: pen ? pen.home : null,
          awayPen: pen ? pen.away : null,
          homeWinner: f.teams.home.winner,
          awayWinner: f.teams.away.winner,
        };
      });

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        // Cache at the edge briefly so a burst of visitors doesn't multiply
        // API-Football calls (free tier is 100 requests/day).
        "Cache-Control": "public, max-age=300",
      },
      body: JSON.stringify({ updated: new Date().toISOString(), fixtures }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: String(err) }),
    };
  }
};
