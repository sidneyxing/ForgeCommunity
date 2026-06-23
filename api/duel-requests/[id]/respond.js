import handler from "../../[...path].js";

export default function respondRoute(req, res) {
  req.query.path = ["duel-requests", req.query.id, "respond"];
  return handler(req, res);
}
