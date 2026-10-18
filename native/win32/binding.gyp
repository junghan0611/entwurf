{
	"targets": [
		{
			"target_name": "entwurf_win",
			"sources": ["entwurf_win.c"],
			"defines": ["NAPI_VERSION=8"],
			"conditions": [
				[
					"OS=='win'",
					{
						"libraries": ["advapi32.lib"],
						"msvs_settings": {
							"VCCLCompilerTool": { "RuntimeLibrary": 0, "AdditionalOptions": ["/Brepro"] },
							"VCLinkerTool": { "AdditionalOptions": ["/Brepro", "/PDBALTPATH:%_PDB%"] }
						}
					}
				]
			]
		}
	]
}
