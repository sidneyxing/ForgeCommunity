import handler from "../[...path].js";

export default function duelRoute(req, res) {
  req.query.path = ["duel", req.query.action];
  return handler(req, res);
}
