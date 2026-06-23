import handler from "./[...path].js";

export default function leaderboardRoute(req, res) {
  req.query.path = ["leaderboard"];
  return handler(req, res);
}
