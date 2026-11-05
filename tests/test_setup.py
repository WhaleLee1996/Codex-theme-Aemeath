from pathlib import Path
import importlib.util
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'scripts'))
from setup import make_profile

class SetupProfileTests(unittest.TestCase):
    def setUp(self):
        parent=ROOT/'.test-tmp';parent.mkdir(exist_ok=True)
        self.temp=tempfile.TemporaryDirectory(dir=parent)
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.package={'family':'OpenAI.Codex_test','version':'1.0','installedApp':str(self.root/'official/app')}
    def test_isolated_does_not_read_or_create_original_profiles(self):
        result=make_profile(self.package,'1','isolated',self.root/'missing',self.root/'absent')
        self.assertEqual(result,{'schemaVersion':1,'defaultMode':'isolated'})
        self.assertEqual(list(self.root.iterdir()),[])
    def test_original_requires_existing_distinct_profile_directories(self):
        local=self.root/'local';app=local/'Packages/OpenAI.Codex_test/LocalCache/Roaming/Codex';browser=app/'web/Codex';codex=self.root/'user/.codex'
        browser.mkdir(parents=True);codex.mkdir(parents=True)
        result=make_profile(self.package,'1','original',local,self.root/'user')
        self.assertEqual(result['original']['appData'],str(app.resolve()))
        self.assertEqual(result['original']['browserData'],str(browser.resolve()))
        self.assertNotEqual(result['original']['browserData'],result['original']['appData'])
        self.assertEqual(result['original']['codexHome'],str(codex.resolve()))
        self.assertIn('authorizedAt',result['original'])
    def test_missing_original_fails_without_creating_replacements(self):
        with self.assertRaisesRegex(ValueError,'not found'):
            make_profile(self.package,'1','original',self.root/'missing',self.root/'user')
        self.assertEqual(list(self.root.iterdir()),[])
    def test_switching_to_isolated_retains_previous_original_authorization(self):
        original={'authorizedAt':'prior','appData':'saved'}
        result=make_profile(self.package,'1','isolated',self.root,self.root,existing={'original':original})
        self.assertEqual(result['original'],original)
        self.assertEqual(result['defaultMode'],'isolated')

if __name__=='__main__':unittest.main()
