import handler from "./[...path].js";

export default function duelRequestsRoute(req, res) {
  req.query.path = ["duel-requests"];
  return handler(req, res);
}
