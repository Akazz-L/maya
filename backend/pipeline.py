from langgraph.graph import StateGraph, START, END
from backend.models import ChapterState
from backend.agents.planner import planner_node
from backend.agents.drafter import drafter_node
from backend.agents.checker import checker_node


def build_pipeline(planner=planner_node, drafter=drafter_node, checker=checker_node):
    graph = StateGraph(ChapterState)
    graph.add_node("planner", planner)
    graph.add_node("drafter", drafter)
    graph.add_node("checker", checker)
    graph.add_edge(START, "planner")
    graph.add_edge("planner", "drafter")
    graph.add_edge("drafter", "checker")
    graph.add_edge("checker", END)
    return graph.compile()


pipeline = build_pipeline()
