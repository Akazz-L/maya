My own notes and TODO's


The planner, agent that returns the scene plan with the following information using a tool :

        "properties": {
            "goal": {"type": "string", "description": "What this scene accomplishes narratively"},
            "pov_character": {"type": "string", "description": "Whose perspective drives the scene"},
            "location": {"type": "string", "description": "Specific physical location where the scene takes place"},
            "beats": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Ordered list of events in the scene",
            },
            "sensory_anchor": {"type": "string", "description": "Primary sense detail grounding the scene"},
            "opening_image": {"type": "string", "description": "First concrete image the reader sees"},
            "closing_image": {"type": "string", "description": "Last concrete image the reader sees"},
        },
        "required": [
            "goal", "pov_character", "location", "beats",
            "sensory_anchor", "opening_image", "closing_image",
        ],
The planner will take as inputs (prompt), the story bible, characters, the world, previous chapter summaries, the outline beat, ...

Note : The tool here is always called (using `tool_choice`) and helps structuring the outputs message (for the next agent). Note that it is not an actual function called client-side or server-side(anthropric)

Note 2 : Tools can be called iteratively or in parallel, there is a beta_tool that helps with that (see https://platform.claude.com/docs/en/agents-and-tools/tool-use/build-a-tool-using-agent)

Question : Is that how a writer works ? 