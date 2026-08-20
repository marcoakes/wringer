import json

from pipeline.cli import main


def write(tmp_path, data):
    path = tmp_path / "pipeline.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    return str(path)


def test_a_clean_run_exits_zero(tmp_path, capsys):
    path = write(tmp_path, {"a": {"command": "true"}})
    assert main([path]) == 0
    assert "Run succeeded" in capsys.readouterr().out


def test_a_run_with_a_failure_exits_one(tmp_path, capsys):
    path = write(tmp_path, {"a": {"command": "false"}})
    assert main([path]) == 1
    assert "Run did not succeed" in capsys.readouterr().out


def test_an_unreadable_file_exits_two(tmp_path, capsys):
    assert main([str(tmp_path / "missing.json")]) == 2
    assert "cannot read" in capsys.readouterr().err


def test_a_bad_graph_exits_two(tmp_path, capsys):
    path = write(tmp_path, {"a": {"needs": ["ghost"], "command": "true"}})
    assert main([path]) == 2
    assert "ghost" in capsys.readouterr().err
