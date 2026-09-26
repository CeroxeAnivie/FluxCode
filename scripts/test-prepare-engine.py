"""Filesystem rollback regressions for the developer engine preparation tool."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("prepare_engine", Path(__file__).with_name("prepare-engine.py"))
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


class PublishTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.staged = []
        for name in ["engine", "host"]:
            target = self.root / name
            source = self.root / (name + ".download")
            target.write_bytes(b"old-" + name.encode())
            source.write_bytes(b"new-" + name.encode())
            self.staged.append((source, target))

    def test_publishes_verified_pair(self):
        prepare.publish_verified_resources(self.staged)
        for _, target in self.staged:
            self.assertEqual(target.read_bytes(), b"new-" + target.name.encode())
        self.assertFalse(list(self.root.glob("fluxcode-engine-backup-*")))

    def test_locked_second_file_restores_original_pair(self):
        replace = Path.replace

        def locked(source, target):
            if source == self.staged[1][0]:
                raise PermissionError("host is running")
            return replace(source, target)

        with patch.object(Path, "replace", locked), self.assertRaises(PermissionError):
            prepare.publish_verified_resources(self.staged)
        for _, target in self.staged:
            self.assertEqual(target.read_bytes(), b"old-" + target.name.encode())

    def test_failed_rollback_retains_recovery_original(self):
        replace = Path.replace

        def locked(source, target):
            if source == self.staged[1][0] or source.parent.name.startswith("fluxcode-engine-backup-"):
                raise PermissionError("file locked")
            return replace(source, target)

        with patch.object(Path, "replace", locked), self.assertRaises(ExceptionGroup):
            prepare.publish_verified_resources(self.staged)
        backups = list(self.root.glob("fluxcode-engine-backup-*"))
        self.assertEqual(len(backups), 1)
        self.assertEqual((backups[0] / "0").read_bytes(), b"old-engine")

    def test_rollback_removes_newly_created_first_file(self):
        self.staged[0][1].unlink()
        replace = Path.replace

        def locked(source, target):
            if source == self.staged[1][0]:
                raise PermissionError("host is running")
            return replace(source, target)

        with patch.object(Path, "replace", locked), self.assertRaises(PermissionError):
            prepare.publish_verified_resources(self.staged)
        self.assertFalse(self.staged[0][1].exists())


if __name__ == "__main__":
    unittest.main()
