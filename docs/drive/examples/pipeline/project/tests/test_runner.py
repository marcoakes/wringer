from pipeline.graph import Graph
from pipeline.runner import FAILED, OK, run, succeeded


def executor(failing=()):
    """An execute() that fails whichever commands are named."""
    seen = []

    def execute(command):
        seen.append(command)
        if command in failing:
            return 1, f"{command} blew up"
        return 0, ""

    return execute, seen


def test_every_job_runs_when_nothing_fails():
    graph = Graph.from_data(
        {
            "build": {"command": "b"},
            "test": {"needs": ["build"], "command": "t"},
        }
    )
    execute, seen = executor()
    results = run(graph, execute)
    assert [r.status for r in results] == [OK, OK]
    assert seen == ["b", "t"]


def test_a_failure_is_recorded_with_its_output():
    graph = Graph.from_data({"build": {"command": "b"}})
    execute, _ = executor(failing={"b"})
    (result,) = run(graph, execute)
    assert result.status == FAILED
    assert "blew up" in result.detail


def test_a_job_nothing_depends_on_does_not_stop_the_others():
    graph = Graph.from_data(
        {
            "lint": {"command": "l"},
            "build": {"command": "b"},
            "test": {"needs": ["build"], "command": "t"},
        }
    )
    execute, seen = executor(failing={"l"})
    results = run(graph, execute)
    by_name = {r.name: r.status for r in results}
    assert by_name["lint"] == FAILED
    assert by_name["build"] == OK
    assert by_name["test"] == OK
    assert "t" in seen


def test_succeeded_is_false_when_anything_failed():
    graph = Graph.from_data({"build": {"command": "b"}})
    execute, _ = executor(failing={"b"})
    assert not succeeded(run(graph, execute))


def test_succeeded_is_true_when_nothing_failed():
    graph = Graph.from_data({"build": {"command": "b"}})
    execute, _ = executor()
    assert succeeded(run(graph, execute))
