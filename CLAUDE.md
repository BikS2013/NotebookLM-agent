<structure-and-conventions>
## Structure & Conventions

- Every time you want to create a test script, you must create it in the test_scripts folder. If the folder doesn't exist, you must make it.

- All the plans must be kept under the docs/design folder inside the project's folder in separate files: Each plan file must be named according to the following pattern: plan-xxx-<indicative description>.md

- The complete project design must be maintained inside a file named docs/design/project-design.md under the project's folder. The file must be updated with each new design or design change.

- All the reference material used for the project must be collected and kept under the docs/reference folder.
- All the functional requirements and all the feature descriptions must be registered in the /docs/design/project-functions.MD document under the project's folder.

<configuration-guide>
- If the user ask you to create a configuration guide, you must create it under the docs/design folder, name it configuration-guide.md and be sure to explain the following:
  - if multiple configuration options exist (like config file, env variables, cli params, etc) you must explain the options and what is the priority of each one.
  - Which is the purpose and the use of each configuration variable
  - How the user can obtain such a configuration variable
  - What is the recomented approach of storing or managing this configuration variable
  - Which options exist for the variable and what each option means for the project
  - If there are any default value for the parameter you must present it.
  - For configuration parameters that expire (e.g., PAT keys, tokens), I want you to propose to the user adding a parameter to capture the parameter's expiration date, so the app or service can proactively warn users to renew.
</configuration-guide>

- Every time you create a prompt working in a project, the prompt must be placed inside a dedicated folder named prompts. If the folder doesn't exists you must create it. The prompt file name must have an sequential number prefix and must be representative to the prompt use and purpose.

- You must maintain a document at the root level of the project, named "Issues - Pending Items.md," where you must register any issue, pending item, inconsistency, or discrepancy you detect. Every time you fix a defect or an issue, you must check this file to see if there is an item to remove.
- The "Issues - Pending Items.md" content must be organized with the pending items on top and the completed items after. From the pending items the most critical and important must be first followed by the rest.

- When I ask you to create tools in the context of a project everything must be in Typescript.
- Every tool you develop must be documented in the project's Claude.md file
- The documentation must be in the following format:
<toolName>
    <objective>
        what the tool does
    </objective>
    <command>
        the exact command to run
    </command>
    <info>
        detailed description of the tool
        command line parameters and their description
        examples of usage
    </info>
</toolName>

- Every time I ask you to do something that requires the creation of a code script, I want you to examine the tools already implemented in the scope of the project to detect if the code you plan to write, fits to the scope of the tool.
- If so, I want you to implement the code as an extension of the tool, otherwise I want you to build a generic and abstract version of the code as a tool, which will be part of the toolset of the project.
- Our goal is, while the project progressing, to develop the tools needed to test, evaluate, generate data, collect information, etc and reuse them in a consistent manner.
- All these tools must be documented inside the CLAUDE.md to allow their consistent reuse.

- When I ask you to locate code, I need to give me the folder, the file name, the class, and the line number together with the code extract.
- Don't perform any version control operation unless I explicitly request it.

- When you design databases you must align with the following table naming conventions:
  - Table names must be singular e.g. the table that keeps customers' data must be called "Customer"
  - Tables that are used to express references from one entity to another can by plural if the first entity is linked to many other entities.
  - So we have "Customer" and "Transaction" tables, we have CustomerTransactions.

- You must never create fallback solutions for configuration settings. In every case a configuration setting is not provided you must raise the appropriate exception. You must never substitute the missing config value with a default or a fallback value.
- If I ask you to make an exception to the configuration setting rule, you must write this exception in the projects memory file, before you implement it.
</structure-and-conventions>

# NotebookLM Agent

## Project Overview

An AI agent built on Google ADK (Agent Development Kit) that manages Google NotebookLM collections through natural language. Uses the `nlm` CLI tool for NotebookLM operations and the YouTube Data API v3 for YouTube content discovery.

## Tools

<YouTubeTools>
    <objective>
        Five ADK FunctionTools that enable searching YouTube, retrieving video metadata,
        fetching transcripts, and listing channel videos. These tools allow the agent to
        discover YouTube content and integrate it with NotebookLM notebooks.
    </objective>
    <command>
        Tools are registered in the agent and invoked by the LLM automatically.
        No direct CLI command -- they are part of the ADK agent tool set.
    </command>
    <info>
        The YouTube tools are defined in notebooklm_agent/tools/youtube-tools.ts and backed
        by the HTTP client in notebooklm_agent/tools/youtube-client.ts.

        Requires YOUTUBE_API_KEY environment variable (no fallback).

        Tool 1: search_youtube
            Search YouTube for videos matching a query.
            Parameters:
                query (string, required) - Search keywords, title fragments, or topic
                max_results (number, optional) - Max results 1-25
                channel_id (string, optional) - Restrict to a specific channel
                order (enum, optional) - "relevance" | "date" | "viewCount" | "rating"
            Quota cost: 100 units per call

        Tool 2: get_video_info
            Get detailed metadata about a YouTube video (title, description, duration,
            views, likes, tags, category, channel info).
            Parameters:
                video_id (string, required) - Video ID or full YouTube URL
            Quota cost: 1 unit per call

        Tool 3: get_video_description
            Get only the description text of a YouTube video (truncated to 5000 chars).
            Parameters:
                video_id (string, required) - Video ID or full YouTube URL
            Quota cost: 1 unit per call

        Tool 4: get_video_transcript
            Get the full transcript/captions of a YouTube video with timestamps.
            Works with auto-generated and manual captions.
            Parameters:
                video_id (string, required) - Video ID or full YouTube URL
                language (string, optional) - Preferred language code (e.g., "en", "es")
            Quota cost: 0 units (uses youtube-transcript-plus, not the API)

        Tool 5: list_channel_videos
            List videos from a YouTube channel. Accepts channel ID, @handle, or URL.
            Parameters:
                channel_id (string, required) - Channel ID, @handle, or channel URL
                max_results (number, optional) - Max results 1-50
                order (enum, optional) - "date" | "viewCount" | "relevance" | "rating"
            Quota cost: 101 units (100 search + 1 channel resolution)

        Supporting modules:
            youtube-client.ts - HTTP client for YouTube Data API v3 with:
                - YouTubeApiResult<T> union type for all responses
                - extractVideoId() - parses any YouTube URL format to video ID
                - parseDuration() - ISO 8601 duration to seconds
                - youtubeSearchVideos() - search.list endpoint wrapper
                - youtubeGetVideos() - videos.list endpoint wrapper
                - resolveChannelId() - handle/URL to UC-prefixed channel ID
                - Error classification (rate_limit, config_error, not_found, error)
                - AbortController-based 10s timeout on all requests

        Daily API quota: 10,000 units (free tier).
    </info>
</YouTubeTools>
