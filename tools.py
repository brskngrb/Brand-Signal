"""Original optional Tavily search tool, without third-party dependencies."""
import json
import os
import urllib.request


def search_web(query):
    key = os.environ.get("TAVILY_API_KEY")
    if not key:
        raise RuntimeError("請先設定 TAVILY_API_KEY；網站介面的搜尋功能不需要這項設定。")
    request = urllib.request.Request("https://api.tavily.com/search", json.dumps({
        "api_key": key, "query": query, "search_depth": "basic", "max_results": 5,
        "include_answer": False}).encode("utf-8"), {"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(request, timeout=30) as response:
        data = json.load(response)
    return [{field: item.get(field, "") for field in ("title", "url", "content")}
            for item in data.get("results", [])]
