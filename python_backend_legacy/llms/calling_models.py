import html

import pandas as pd
from bs4 import BeautifulSoup
from tqdm import tqdm




from pathlib import Path
from typing import Dict, List, Any, Optional

import PIL
import PyPDF2
import docx
import fitz
import requests


from dotenv import load_dotenv


load_dotenv()  # Load .env file if present
import os
from dotenv import load_dotenv

load_dotenv()  # Load environment variables from .env file

# Example API keys (replace with actual keys)
OPENAI_API_KEY = os.environ.get('OPENAI_API_KEY')
DEEPSEEK_API_KEY = os.environ.get('DEEP_SEEK_API_KEY')
GEMINI_API_KEY = os.getenv('LU_GEMINI_API_KEY')
NO_VISION_MSG = "\note: even if there is no image attached, you can visualise the graph by the description that will be given below\n"


def extract_contents_by_citation_key(batch_path, custom_id):
    """
    Extracts and returns a list of 'content' strings from a JSONL file,
    where the 'custom_id' contains the specified citation_key.
    """
    results = []
    with open(batch_path, 'r', encoding='utf-8') as f:
        for line in f:
            # Safely parse the JSON in each line
            data = json.loads(line.strip())

            custom_id_batch = data.get("custom_id", "")
            # Check if the citation_key is in the custom_id (case-insensitive)
            if custom_id == custom_id_batch:
                # Navigate to the 'content' field
                content = (
                    data["response"]
                    ["body"]
                    ["choices"][0]
                    ["message"]
                    ["content"]
                )

                results.append(ast.literal_eval(content))

    return results



def _unwrap_schema(wrapper: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Accepts a wrapper that may contain either "schema" or "parameters".
    Returns the inner JSON-Schema object (or {} if missing).
    """
    if not wrapper:
        return {}

    if "parameters" in wrapper and isinstance(wrapper["parameters"], dict):
        return wrapper["parameters"]

    if "schema" in wrapper and isinstance(wrapper["schema"], dict):
        return wrapper["schema"]

    return {}

def prepare_batch_requests(
    text_to_send: str,
    custom_id: str,
    content: str,
    schema_wrapper: Optional[Dict[str, Any]],
    model: str,
) -> Dict[str, Any]:
    """
    Build a single request payload for `/v1/responses` that works for all models,
    using the structured-output spec (json_schema).
    """
    schema: Dict[str, Any] = _unwrap_schema(schema_wrapper)
    is_o_series = model.lower().startswith("o")

    body: Dict[str, Any] = {
        "model": model,
        "input": [
            {"type": "message", "role": "system", "content": content},
            {"type": "message", "role": "user", "content": text_to_send},
        ],
        "instructions": None,
    }

    if is_o_series and not model.lower().startswith("gpt-4"):
        body["reasoning"] = {"effort": "low"}

    if schema:
        body["text"] = {
            "format": {
                "type": "json_schema",
                "name": (schema_wrapper or {}).get("name", "json_schema"),
                "schema": schema,
                "strict": (schema_wrapper or {}).get("strict", True),
            }
        }
    else:
        body["text"] = {"format": {"type": "text"}}

    return {
        "custom_id": custom_id,
        "method": "POST",
        "url": "/v1/responses",
        "body": body,
    }


def call_openai_api(data,function,model="gpt-5-mini", batch=False,id="",eval=True,collection_name="",read=False,store_only=None,custom_id=""):
    from openai import OpenAI
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    # Open and read the prompts from a JSON file
    with open(r'/legacy_prompts.json', 'r', encoding="utf-8") as f:
        prompts = json.load(f)  # Load the JSON content into a Python dictionary


    prompt = prompts[function]['prompt'] +f"\n input data:{data}"
    schema=prompts[function]['json_schema']

    content =prompts[function]['content']

    config = prompts[function].get('config',"")


    if read :
        output_file=fr"C:\Users\luano\Downloads\AcAssitant\Files\Batching_files\{collection_name}\{collection_name}_{function}_output.jsonl"
        response=read_completion_results(custom_id=custom_id,path=output_file,function=function)


        if response:
            return response

    if store_only:

        directory_path = os.path.join(
            r"C:\Users\luano\Downloads\AcAssitant\Files\Batching_files",collection_name
        )
        os.makedirs(directory_path, exist_ok=True)
        batch_request=prepare_batch_requests(text_to_send=prompt,content=content, schema=schema,model=model,read=read,custom_id=custom_id)

        write_batch_requests_to_file(batch_request=batch_request,file_name=fr"C:\Users\luano\Downloads\AcAssitant\Files\Batching_files\{collection_name}\{collection_name}_{function}_input.jsonl")
        return batch_request



    response = client.chat.completions.create(
        model="gpt-4.1",
        messages=[
            {
                "role": "system",
                "content": [
                    {
                        "type": "text",
                        "text": prompt
                    }
                ]
            }
        ],
        response_format={
            "type": "json_object"
        },
        tools=[
            {
                "type": "function",
                "function": {
                    "name": "return_keyword_hierarchy",
                    "description": "Returns a hierarchical clustering of keywords for a mind-map.",
                    "parameters": {
                        "type": "object",
                        "required": [
                            "name",
                            "size",
                            "children"
                        ],
                        "properties": {
                            "name": {
                                "type": "string",
                                "description": "Node label (cluster name or keyword)."
                            },
                            "size": {
                                "type": "integer",
                                "description": "Document frequency for *leaf* keywords; omit for clusters."
                            },
                            "children": {
                                "type": "array",
                                "description": "Sub-nodes of this cluster.",
                                "items": {
                                    "$ref": "#"
                                }
                            }
                        },
                        "additionalProperties": False
                    },
                    "strict": True
                }
            }
        ],

        # max_completion_tokens=14316,
        top_p=1,
        frequency_penalty=0,
        presence_penalty=0
    )


    r=parse_llm_response(response)


    return r
    # if eval:
    #     if function=="getting_keywords":
    #         message=message.replace("\n","")
    #     try:
    #         if isinstance(message, str):
    #             message = json.loads(message)
    #     except Exception as e:
    #         print(message)
    #         print('err, trying again',e.with_traceback(e.__traceback__))
    #         print('response\n', response)
    #
    #
    #         print(prompt)
    #         input('openai failed, data above')
    #         message=call_openai_api(data=data,id=id,function=function,batch=batch,model=model)

    # if function=="topic_sentence":
    #     return message['result']
    # return message


import logging
from typing import Any, Union

def parse_llm_response(response) -> Union[dict, list, str, None]:
    """
    Extracts the "payload" from a ChatCompletionResponse, trying in this order:
      1) message.content (and JSON-decoding it if valid JSON)
      2) message.function_call.arguments (and JSON-decoding it if it's a string)
      3) tool_calls[i].function.arguments (first non-empty, with same JSON logic)
      4) returns None and logs a warning if nothing found
    """
    msg = response.choices[0].message

    # 1) Try raw content
    if getattr(msg, "content", None):
        text = msg.content.strip()
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return text

    # 2) Try a function_call
    fc = getattr(msg, "function_call", None)
    if fc and getattr(fc, "arguments", None):
        args = fc.arguments
        if isinstance(args, str):
            try:
                return json.loads(args)
            except json.JSONDecodeError:
                return args
        return args

    # 3) Try any tool_calls
    calls = getattr(msg, "tool_calls", None) or []
    for call in calls:
        func = getattr(call, "function", None)
        if func and getattr(func, "arguments", None):
            args = func.arguments
            if isinstance(args, str):
                try:
                    return json.loads(args)
                except json.JSONDecodeError:
                    return args
            return args

    logging.warning("No parsable content, function_call or tool_calls in LLM response.")
    return None
#
# def read_completion_results(custom_id, path,function, exact=True):
#     """
#     Reads a JSONL output file and returns the response where the custom_id matches.
#
#     Args:
#         custom_id (str): The custom identifier to search for (e.g., "ApplicationRevisionJudgment2003-0-8528344").
#         path (str): The path to the output JSONL file.
#
#     Returns:
#         dict or None: The exact response dictionary if a match is found; otherwise, None.
#     """
#     if not os.path.exists(path):
#         print(f"Output file not found: {path}")
#         return None
#
#     try:
#         with open(path, 'r', encoding='utf-8') as f:
#             for line_number, line in enumerate(f, start=1):
#                 stripped_line = line.strip()
#                 if not stripped_line:
#                     continue  # Skip empty lines
#                 try:
#                     data = json.loads(stripped_line)
#
#                 except json.JSONDecodeError:
#                     print(f"Skipping malformed JSON at line {line_number}.")
#                     continue  # Skip malformed lines
#
#
#
#
#
#                 if custom_id in data.get("custom_id", []):
#                 # if data.get("custom_id") == custom_id:
#
#
#                     content=data["response"]["body"]["choices"][0]["message"]['content']
#                     if function=="paper":
#                         return content
#                     response= ast.literal_eval(content)
#                     if function == "topic_sentence":
#                         return response['result']
#                     if response:
#                         return response
#                     else:
#                         print(f"No 'response' field found for custom_id: {custom_id}")
#                         return None
#
#         print(f"No matching custom_id '{custom_id}' found in file: {path}")
#         return None
#
#     except Exception as e:
#
#         print(f"An error occurred while reading the file: {e}")
#         return None
import os
import ast
#
# def read_completion_results(custom_id, path, function, model=None, by_index=None):
#     """
#     ... (unchanged docstring except: now returns (response, cost_usd)) ...
#     Added parameter
#         by_index (int | None): if an integer is supplied, the line with this
#         zero-based index is returned instead of searching by custom_id.
#     """
#
#     # code to be replaced
#     # print(f"processing custom_id {custom_id}")
#     print(f"processing index {by_index}" if by_index is not None
#           else f"processing custom_id {custom_id}")
#
#     if not os.path.exists(path):
#         print(f"Error: Output file not found at '{path}'")
#         return None, None  # ---- now tuple
#
#     try:
#         with open(path, 'r', encoding='utf-8') as f:
#             for line_number, line in enumerate(f, start=1):
#                 stripped_line = line.strip()
#                 if not stripped_line:
#                     continue
#                 try:
#                     data = json.loads(stripped_line)
#                 except json.JSONDecodeError:
#                     print(f"Warning: Skipping malformed JSON at line {line_number}.")
#                     continue
#
#                 # code to be replaced
#                 # if data.get("custom_id") != custom_id:
#                 #     continue  # next record
#                 if by_index is not None:
#                     if (line_number - 1) != by_index:
#                         continue
#                 else:
#                     if data.get("custom_id") != custom_id:
#                         continue  # next record
#
#                 # --- extract content ---
#                 try:
#                     output_list = data["response"]["body"]["output"]
#                     message_obj = [it for it in output_list if it.get("type") == "message"][-1]
#                     content_str = message_obj["content"][0]["text"]
#                 except Exception as e:
#                     print(f"Failed to extract message: {e}")
#                     continue
#
#                 # --- compute cost ---
#                 usage = data["response"]["body"].get("usage", {})
#                 prompt_toks = usage.get("input_tokens") or usage.get("prompt_tokens", 0)
#                 completion_toks = usage.get("output_tokens") or usage.get("completion_tokens", 0)
#                 model_name = model or data["response"]["body"].get("model") or "unknown"
#
#                 # --- normalise return ----
#                 if function == "paper":
#                     processed = content_str
#                 else:
#                     try:
#                         parsed_content = json.loads(content_str)
#                     except json.JSONDecodeError:
#                         print("Content not JSON; raw returned.")
#                         processed = content_str
#                     else:
#                         processed = parsed_content.get('result') if function == "topic_sentence" else parsed_content
#
#                 return processed # <-- new tuple
#
#         print(f"Info: No matching record found (custom_id='{custom_id}', by_index={by_index}).")
#         return None, None
#
#     except Exception as e:
#         print(f"Unexpected error while reading the file: {e}")
#         return None, None



def unstructured_api(text, model="gpt-5-mini", read=False, collection_name="", function="paper", custom_id="",
                     store_only=None):
    print("unstructured api")
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    content_message = """ Convert an academic paper into an HTML document. 

Split the Raw Text into Lines

Read the text line by line.

Detect Headings

- For each line, test if it matches a heading pattern (numerical, roman, alphabetical).
- If yes, parse out the heading level and label accordingly (e.g., <h1>, <h2>).

Aggregate Paragraphs

- If not a heading, accumulate lines until you hit a blank line or a known paragraph break (double newline).
- Merge them into a single paragraph block.
- Fix hyphenations that happen at line endings.

Footnote Detection

- While accumulating lines, watch for lines that start like footnotes \\d+\\. 
- Parse them out, store them in a footnote dictionary or list: key = footnote number, value = text.
- In the main paragraph, wherever you detect references like [1], (1), or “supra note 1”, wrap them in <sup><a href="#ref1" title="footnote text">1</a></sup>.

Apply Additional Rules

- For “fragmented paragraphs,” if you see a page-break marker or a paragraph that ends abruptly without a full stop or semicolon, you might apply an id="fragmented_paragraph".
- Ensure you keep the text order consistent and do not lose any lines.

Output the Structured HTML

- Output each heading block with <hX> ... </hX>.
- Output each paragraph block with <p> ...</p> (ensure footnotes are applied using sup and href as described).
- Insert footnotes as needed.

# Notes

- This is a raw academic paper text including main paragraphs and footnotes. I am sending a range of pages where paragraphs come first and there is a footnote area at the bottom of the page. This means that every time, you will receive a set of paragraphs with numbered in-text citation and their respective footnote below it. You should distinguish paragraphs from footnotes so that you insert footnote information in the href with sup, following the instructions of the user.
- Do not return footnotes as paragraphs. Footnotes should always come inside href mapped to the in-text citation. So if the pattern text+digit is found as in-text citation and a pattern of the same digit +text is found just after, then the latter is the footnote information and should be inside the former href title.
- Your response should not contain reference section or abstract text 
-Return sections and paragraphs where footnotes are inside the href
- before send the output, review and verify if 1. every footnote appears inside the href mapped to the in-text citation;2 there is no paragraphs missing as the raw text were completely converted without losing any text.

"""
    citation = str([
        r'\b([a-zA-Z]+)\.\d+\b(?!\.\d|\w)',  # Matches word.number
        r'\b\d{4}\.\d+\b',  # Matches 4-digit number.number
        r'\b\w+\)\d+\b',  # Matches word)number
        r'\b\w+;\d+\b',  # Matches word;number
        r'\b\w+\.\"\d+\b|',  # Matches word.'number
        r'\b\w+\"\d+\b|',  # Matches word'number
        r'\b\w+\.\'\d+\b|',  # Matches word.'"number
        r'\b\w+\.\"\d+\|',  # Matches word.''number
        r'\b\d+\.\"\d+\b|',  # Matches number.'number
        r',\'?\d+\b',  # Matches ,"number or ,'number
        r'\b\w+\,\"\d+\b|',  # Matches word,"number or word,'number
        r'\b[a-zA-Z]+,\d+\b|',  # Matches word,number
        r'\b\d{4}\,\d+\b|',  # Matches 4-digit number,number
        r'\),\d+\b',  # Matches )number
        r'(?<![\w./])\b(?![A-Z]{2}\d+\b)[a-zA-Z]+\d+\b(?![\w./])'  # Matches word+number
    ])
    html_template = """```html <div>

    <h1><!-- Main Title Here --></h1>


    <!-- 
        2. Introduction and Other Sections/subsections
        Detect numbered or titled sections and assign appropriate heading levels.
        For example, main sections as <h1>, subsections as <h2>, etc.
    -->
    <h1>1. Introduction</h1>
    <p><!-- Introduction Paragraphs Here --></p>

    <!-- 
        2. Lists
        Detect bulleted or numbered lists and convert them to <ul>/<ol> with <li>.
    -->
    <ul>
        <li><!-- List Item 1 --></li>
        <li><!-- List Item 2 --></li>
        <!-- Add more <li> as needed -->
    </ul>

    <!-- 
        3. Tables
        Detect tables and structure them using <table>, <thead>, <tbody>, <tr>, <th>, and <td>.
    -->
    <table>
        <thead>
            <tr>
                <th><!-- Header 1 --></th>
                <th><!-- Header 2 --></th>
                <!-- Add more <th> as needed -->
            </tr>
        </thead>
        <tbody>
            <tr>
                <td><!-- Row 1, Column 1 --></td>
                <td><!-- Row 1, Column 2 --></td>
                <!-- Add more <td> as needed -->
            </tr>
            <!-- Add more <tr> for additional rows -->
        </tbody>
    </table>

    <!-- 
        4. In-Text Citations
        Detect citations like [1], (1), or similar patterns and wrap them in <sup><a></a></sup>.
        Example: <sup><a href="#ref1" title="Full Footnote Text">1</a></sup>
    -->
    <p>
        This is an example sentence with an in-text citation<sup><a href="#ref1" title="Full footnote text here.">1</a></sup>.
    </p>

    <!-- 
        5. Fragmented Paragraph
        Detect the last paragraph of the chunk and do not complete it . Instead, format paragraphs as they are.
    -->
    <p><!-- Fragmented Paragraph Here --></p>
</div>"""

    prompt = (
        f"Task Overview: Convert the provided academic text chunk into properly formatted HTML within a single `<div>` tag, excluding `<html>`, `<head>`, or `<body>` tags where the last paragraph fragmented paragraph should receive an id=`fragmented_paragraph`. Preserve the original text, only adding HTML tags for structure."
        f" Instructions:"
        f" 1) -Keep the original wording, punctuation, and formatting intact. -Only add necessary HTML tags for structure. 100% of the text integrity should be conserved "
        f"2) Use a single <div> container, excluding document-level tags, and omit headers like page numbers, journal title, or metadata. "
        f"3) Identify headings/subheadings by their formatting (e.g., starting with numerals/letters 1., I., A., a.; having different indent; being short followed by big text block...). Assign <h1> to main sections, <h2> to subsections, etc.,"
        f"4) wrap paragraphs in <p> tags without nesting. For fragmented words separated by hyphens due to line breaks, join them to form complete words within paragraphs, cleaning the line and hyphen. if a paragraph is fragmented, meaning,"
        f"does not finish by a full stop and it is at the end of the chunk text, you must return the fragmented paragraph fragmented without completing it, respecting its  integrity. Your response should not contain paragraph duplicates  "
        f"5) Identify footnotes in the document by detecting lines beginning with a numeral followed by a full stop or space (e.g., '1. Text' ), using keywords like 'see', 'cf.', 'para.', 'supra', 'id.','ibid.', and 'refer to', which are "
        f"common in legal and academic references; use regular expressions like \\b\\d+\\.\\s.* for basic numbered footnotes and \\b\\d+\\.\\s+(see|cf\\.|para\\.|supra\\.|id\\.|ibid\\.)\\b.* to include keywords; ensure the extracted text is a standalone reference or comment, as typical footnotes are, and does not continue directly from preceding paragraphs. "
        f"6) For in-text citations: detect citations like {citation} or the like where numbers are between [] . Wrap citation numbers in <sup> and <a> tags linking to references, inserting footnote details in the <a> tag's title attribute. Example:"
        f" '...text<sup><a href=\"#ref1\" title=\" the extracted full footnote\">1</a></sup>...'. the numbers intext citation and footnotes must be identical, do not modify the footnote/sup numbers, just extract them. No footnotes section is needed "
        f"7) lists,tables: Identify and properly format lists using <ul> or <ol> and <li> tags. Identify and format tables using <table>, <thead>, <tbody>, <tr>, <th>, <td>, and <caption> tags."
        f" 8) Final HTML Output: Ensure syntax is error-free, Use chain-of-thought reasoning:  go through every step in the instruction and identify and tag sections, paragraphs, citations, and footnotes step-by-step, ensuring correct placement."
        f" 9) Consistency: -Close all nested html tags before opening a new section, -Verify all tags, ensuring each open tag has a corresponding close tag, -Verify all tags, ensuring each open tag has a corresponding close tag,-Avoid duplicating <div> tags unnecessarily. "
        f"10) Additional Considerations: Ensure no text alteration; validate output for accuracy."
        f"return all the chunk academic text converted. Chunk text for conversion: \n\n[[{text}]]\nexample of output:{html_template}")

    if read:
        output_file = fr"C:\Users\luano\Downloads\AcAssitant\Files\Batching_files\{collection_name}\{collection_name}_{function}_output.jsonl"

        response = read_completion_results(custom_id=read, path=output_file, function=function)

        if response:
            return response
    if store_only:
        directory_path = os.path.join(
            r"C:\Users\luano\Downloads\AcAssitant\Files\Batching_files",
            collection_name
        )
        os.makedirs(directory_path, exist_ok=True)
        batch_request = prepare_batch_requests(text_to_send=prompt, content=content_message, schema=None, read=read,
                                               custom_id=custom_id, model=model)

        write_batch_requests_to_file(batch_request=batch_request,
                                     file_name=fr"C:\Users\luano\Downloads\AcAssitant\Files\Batching_files\{collection_name}\{collection_name}_{function}_input.jsonl")
        return batch_request

    response = client.chat.completions.create(
        model="o3-mini-2025-01-31",
        messages=[
            {
                "role": "developer",
                "content": [
                    {
                        "type": "text",
                        "text": content_message
                    }
                ]
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": prompt
                    }
                ]
            }
        ],

        response_format={
            "type": "text"
        },
        reasoning_effort="high"

    )

    return response.choices[0].message.content.strip()


def retry_api_call(data, function, model='gpt-5-mini', max_retries=3, delay=2):
    attempt = 0
    response = None
    while attempt < max_retries:
        try:
            # Make the API call
            response = call_openai_api(
                data=data,
                function=function,
                id='',
                model=model
            )
            print(f'Attempt {attempt + 1} successful')

            # Parse response if it's a string
            if isinstance(response, str):
                response = ast.literal_eval(response)['subheadings']
            return response  # Return if successful

        except Exception as e:
            attempt += 1
            print(f'Error on attempt {attempt}: {e}')
            print(f'Response: {response}')

            if attempt < max_retries:
                print(f'Retrying in {delay} seconds...')
                time.sleep(delay)  # Wait before retrying
            else:
                print('Max retries reached. Aborting.')

    return None  # Return None if all attempts fail


def extract_text_from_pdf(file_path):
    doc = fitz.open(file_path)
    text_by_pages = []
    for page_num in range(len(doc)):
        page = doc.load_page(page_num)  # Load each page
        text = page.get_text("text")  # Extract text from the page
        if text.strip():  # Only add non-empty text
            text_by_pages.append(text)

    return text_by_pages


def get_embedding(text):


    """Generate an embedding for the given text using OpenAI's most capable embedding model."""
    response = client.embeddings.create(
        model="text-embedding-3-large",  # Use the most capable model, with 3,072 dimensions
        input=text
    )
    return response.data[0].embedding




def write_batch_requests_to_file(batch_request,
                                 file_name=r"C:\Users\luano\Downloads\AcAssitant\Files\Batching_files\batchinput.jsonl"):
    import json
    with open(file_name, "a+", encoding="utf-8") as f:
        # Convert the batch_request dictionary into a JSON string
        json_string = json.dumps(batch_request, ensure_ascii=False, separators=(',', ':'))

        # Open the file in append mode and write the JSON string to it
        with open(file_name, "a+", encoding="utf-8") as f:
            f.write(json_string + "\n")
    return file_name


def upload_batch_file(file_name):
    """
    Upload a JSONL file to OpenAI.

    Args:
    - file_name (str): The name of the JSONL file to upload.

    Returns:
    - str: The ID of the uploaded batch input file.
    """
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

    # Upload the batch input file
    with open(file_name, "rb") as f:
        batch_input_file = client.files.create(file=f, purpose="batch")
    batch_input_file_id = batch_input_file.id
    print(f"[DEBUG] Batch input file {file_name} uploaded successfully. File ID: {batch_input_file_id}")

    return batch_input_file_id


def create_batch(batch_input_file_id):
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

    # Create the batch
    batch = client.batches.create(
        input_file_id=batch_input_file_id,
        endpoint="/v1/chat/completions",
        completion_window="24h",
        metadata={"description": "Batch processing for statements_citations"}
    )
    return batch.id


def check_save_batch_status(batch_id):
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

    while True:
        status = client.batches.retrieve(batch_id)
        print(f"[DEBUG] Checking status of batch ID {batch_id}: {status.status}")
        if status == "completed":
            retrieve_batch_results(batch_id)
            save_batch_object(r"C:\Users\luano\Downloads\AcAssitant\Batching_files", status)
            break
        if status.status in ['failed', 'expired']:
            break
        time.sleep(60)  # Check status every minute

    return status.status


def retrieve_batch_results(batch_id):
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    status = client.batches.retrieve(batch_id)
    if status.status == 'completed':
        output_file_id = status.output_file_id
        file_response = client.files.content(output_file_id)
        results = [json.loads(line) for line in file_response.text.splitlines()]
        print("[DEBUG] Batch processing completed successfully.")
        return results
    else:
        print("[DEBUG] Batch processing failed or expired.")
        return None

def _get_batch_root() -> Path:
        root = os.getenv("BATCH_ROOT")
        p = Path(root) if root else Path.home() / "Batching_files"
        p.mkdir(parents=True, exist_ok=True)
        return p

def safe_name(s: str, *, maxlen: int = 120) -> str:
    s = "" if s is None else str(s)
    s = s.strip()

    # Replace Windows-reserved characters and collapse whitespace
    s = re.sub(r'[\\/:*?"<>|]+', "_", s)
    s = re.sub(r"\s+", "_", s)

    # Convert dots to underscores to avoid trailing-dot problems
    s = s.replace(".", "_")

    # Keep conservative charset
    s = re.sub(r"[^0-9A-Za-z_-]+", "_", s)

    # Remove repeated underscores
    s = re.sub(r"_+", "_", s)

    # Strip leading/trailing underscores, dots, spaces (Windows dislikes trailing . or space)
    s = s.strip(" _.")
    if not s:
        s = "default"

    # Trim length
    if len(s) > maxlen:
        h = hashlib.sha1(s.encode("utf-8")).hexdigest()[:8]
        s = f"{s[:maxlen-9]}_{h}"

    return s
def _process_batch_for(
    function: str,
    completion_window: str = "24h",
    collection_name: str = "",
    poll_interval: int = 60,
    wait: bool = True,
    download_if_ready: bool = True,
) -> bool:
    """
    Create/submit (if needed) and optionally wait for a single function's batch.
    Uses function-scoped folder and function+collection-scoped metadata files.

    IMPORTANT: Path convention now matches `call_models`:
      <Batching_files>/<function>/<collection_name>_<function>_*.jsonl
    Falls back to slugged paths if raw paths missing.
    """
    import os, json, time, random, re
    from pathlib import Path
    from openai import OpenAI

    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

    # --- roots ---
    root = get_batch_root()             # …/Batching_files
    func_dir = Path(root) / function    # …/Batching_files/<function>
    func_dir.mkdir(parents=True, exist_ok=True)

    # --- helpers ---
    def _slug_name(s: str) -> str:
        # Windows-safe slug used only as a fallback
        return re.sub(r'[^A-Za-z0-9._-]+', '_', str(s or 'default')).strip('_')[:150]

    # prefer RAW names to match call_models
    raw_coll = safe_name(collection_name) or "default"
    raw_func = function or "function"

    raw_meta_path   = func_dir / f"{raw_coll}_{raw_func}_batch_metadata.json"
    raw_input_path  = func_dir / f"{raw_coll}_{raw_func}_input.jsonl"
    raw_output_path = func_dir / f"{raw_coll}_{raw_func}_output.jsonl"

    # slug fallbacks (older/newer code paths might have created these)
    slug_coll = _slug_name(raw_coll)
    slug_func = _slug_name(raw_func)
    slug_meta_path   = func_dir / f"{slug_coll}_{slug_func}_batch_metadata.json"
    slug_input_path  = func_dir / f"{slug_coll}_{slug_func}_input.jsonl"
    slug_output_path = func_dir / f"{slug_coll}_{slug_func}_output.jsonl"

    # choose ACTIVE paths (prefer raw; fall back to slug if present)
    meta_path   = raw_meta_path   if raw_meta_path.exists()   or not slug_meta_path.exists()   else slug_meta_path
    input_path  = raw_input_path  if raw_input_path.exists()  or not slug_input_path.exists()  else slug_input_path
    output_path = raw_output_path if raw_output_path.exists() or not slug_output_path.exists() else slug_output_path

    # If we already have both metadata + output, we're done.
    if meta_path.exists() and output_path.exists():
        return True

    batch_id = None
    input_file_id = None

    # Load existing batch metadata or create a new batch from input
    if meta_path.exists():
        with open(meta_path, "r", encoding="utf-8") as f:
            meta = json.load(f)
        batch_id      = meta.get("batch_id")
        input_file_id = meta.get("input_file_id")

    if not batch_id:
        # If caller is probing (wait=False), don't raise when input is absent.
        if not input_path.exists():
            # second chance: maybe the OTHER variant exists — re-resolve once more
            if input_path is raw_input_path and slug_input_path.exists():
                input_path = slug_input_path
                meta_path  = slug_meta_path
                output_path = slug_output_path
            elif input_path is slug_input_path and raw_input_path.exists():
                input_path = raw_input_path
                meta_path  = raw_meta_path
                output_path = raw_output_path

        if not input_path.exists():
            if not wait:
                return False
            raise FileNotFoundError(f"Missing batch input: {input_path}")

        upload = client.files.create(file=open(input_path, "rb"), purpose="batch")
        input_file_id = upload.id

        batch = client.batches.create(
            input_file_id=input_file_id,
            endpoint="/v1/responses",
            completion_window=completion_window,
        )
        batch_id = batch.id
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump({"batch_id": batch_id, "input_file_id": input_file_id}, f)

    # If caller doesn’t want to wait, return right after submission/rehydration.
    if not wait:
        return True

    # Poll with jitter until completed and output_file_id is present
    consecutive_errors = 0
    last_status = None
    while True:
        try:
            batch = client.batches.retrieve(batch_id)
            status = getattr(batch, "status", None)
            if status != last_status:
                # show which filename we are tracking
                print(f"[batch:{raw_coll}] status → {status} (input={input_path.name})")
                last_status = status

            if status == "completed":
                output_file_id = getattr(batch, "output_file_id", None)
                if output_file_id:
                    break
            elif status in ("failed", "cancelled", "expired"):
                raise RuntimeError(f"Batch {batch_id} ended in status '{status}'")
            consecutive_errors = 0
        except Exception as e:
            consecutive_errors += 1
            if consecutive_errors >= 5:
                raise RuntimeError(f"Polling failed repeatedly for {batch_id}: {e}") from e
            time.sleep(2 ** consecutive_errors + random.uniform(0, 1.5))
            continue

        time.sleep(poll_interval + random.uniform(0, 3.0))

    if not download_if_ready:
        return True

    # Download output once we have a valid output_file_id
    output_file_id = getattr(batch, "output_file_id", None)
    if not output_file_id:
        batch = client.batches.retrieve(batch_id)
        output_file_id = getattr(batch, "output_file_id", None)
        if not output_file_id:
            raise RuntimeError(f"Output not available for {batch_id} (no output_file_id)")

    api_resp = client.files.with_raw_response.retrieve_content(file_id=output_file_id)
    with open(output_path, "wb") as out:
        out.write(api_resp.content)

    return True
# def _process_batch_for(
#     function: str,
#     completion_window: str = "24h",
#     collection_name: str = "",
#     poll_interval: int = 30
# ) -> bool:
#     """
#     Process a single function's batch.
#     Uses function-scoped folder and function-scoped metadata file.
#     """
#     client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
#     root = _get_batch_root()
#     func_dir = root / function
#     func_dir.mkdir(parents=True, exist_ok=True)
#
#     # NOTE: include function in meta filename to avoid collisions!
#     meta_path   = func_dir / f"{collection_name}_{function}_batch_metadata.json"
#     input_path  = func_dir / f"{collection_name}_{function}_input.jsonl"
#     output_path = func_dir / f"{collection_name}_{function}_output.jsonl"
#
#     # 1) Already done?
#     if meta_path.exists() and output_path.exists():
#         return True
#
#     # 2) Load or create batch
#     if meta_path.exists():
#         with open(meta_path, "r", encoding="utf-8") as f:
#             meta = json.load(f)
#         batch_id      = meta["batch_id"]
#         input_file_id = meta["input_file_id"]
#     else:
#         if not input_path.exists():
#             raise FileNotFoundError(f"Missing batch input: {input_path}")
#
#         upload = client.files.create(file=open(input_path, "rb"), purpose="batch")
#         input_file_id = upload.id
#
#         batch = client.batches.create(
#             input_file_id=input_file_id,
#             endpoint="/v1/responses",
#             completion_window=completion_window,
#         )
#         batch_id = batch.id
#
#         with open(meta_path, "w", encoding="utf-8") as f:
#             json.dump({"batch_id": batch_id, "input_file_id": input_file_id}, f)
#
#     # 3) Poll
#     while True:
#         status = client.batches.retrieve(batch_id).status
#         if status == "completed":
#             break
#         if status in ("failed", "cancelled", "expired"):
#             raise RuntimeError(f"Batch {batch_id} ended in status '{status}'")
#         time.sleep(poll_interval)
#
#     output_file_id = client.batches.retrieve(batch_id).output_file_id
#
#     # 4) Download output
#     api_resp = client.files.with_raw_response.retrieve_content(file_id=output_file_id)
#     with open(output_path, "wb") as out:
#         out.write(api_resp.content)
#
#     return True

def process_batch_output_completions(file_path: str, item_id_filter: str = "") -> Dict[str, List[Dict[str, Any]]]:
    """
    Processes a JSON Lines (jsonl) file, clustering the data by the prefix of 'custom_id'.

    Each cluster contains entries with a unique 'id' and the associated 'content'.

    Args:
        file_path (str): The path to the JSONL file.
        item_id_filter (str, optional): A substring to filter 'custom_id's. Only entries containing this filter are processed.
                                        Defaults to an empty string, which means no filtering.

    Returns:
        Dict[str, List[Dict[str, Any]]]:
            A dictionary where each key is the prefix of 'custom_id' (e.g., 'Y3EEKUDQ_paragraph_title'),
            and each value is a list of dictionaries with 'id' and 'content' keys.
    """
    grouped_content: Dict[str, List[Dict[str, Any]]] = {}

    try:
        with open(file_path, 'r', encoding='utf-8') as file:
            for line_number, line in enumerate(file, start=1):
                line = line.strip()
                if not line:
                    continue  # Skip empty lines

                try:
                    data = json.loads(line)
                except json.JSONDecodeError as e:
                    print(f"[Line {line_number}] JSON decoding error: {e}")
                    continue  # Skip malformed JSON lines

                custom_id = data.get('custom_id', '')
                if not custom_id:
                    print(f"[Line {line_number}] Missing 'custom_id'. Skipping entry.")
                    continue  # Skip entries without 'custom_id'

                # Apply filter if 'item_id_filter' is provided
                if item_id_filter and item_id_filter not in custom_id:
                    continue  # Skip entries that don't match the filter

                # Split 'custom_id' into prefix and unique id
                parts = custom_id.split('_', 3)
                if len(parts) < 4:
                    print(f"[Line {line_number}] 'custom_id' format is incorrect: '{custom_id}'. Skipping entry.")
                    continue  # Skip improperly formatted 'custom_id's

                key_prefix = '_'.join(parts[:3])  # e.g., 'Y3EEKUDQ_paragraph_title'
                unique_id = parts[3]  # e.g., '418784930-2f217a59-061e-4ee7-a8b8-a930823e43c3-484a305d'

                # Navigate to the 'choices' list within the JSON structure
                choices = data.get('response', {}).get('body', {}).get('choices', [])
                if not choices:
                    print(f"[Line {line_number}] No 'choices' found for 'custom_id' '{custom_id}'. Skipping entry.")
                    continue  # Skip entries without 'choices'

                for choice in choices:
                    message = choice.get('message', {})
                    content_str = message.get('content', '')

                    if not content_str:
                        print(
                            f"[Line {line_number}] No 'content' found in message for 'custom_id' '{custom_id}'. Skipping choice.")
                        continue  # Skip if 'content' is missing

                    try:
                        # Parse the JSON-formatted string in 'content'
                        content = json.loads(content_str)
                    except json.JSONDecodeError as e:
                        print(f"[Line {line_number}] Error parsing 'content' JSON for 'custom_id' '{custom_id}': {e}")
                        continue  # Skip entries with malformed 'content'

                    # Initialize the list for this key if it doesn't exist
                    if key_prefix not in grouped_content:
                        grouped_content[key_prefix] = []

                    # Append the structured data
                    grouped_content[key_prefix].append({
                        "id": unique_id,
                        "content": content
                    })

    except FileNotFoundError:
        print(f"Error: The file '{file_path}' does not exist.")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")

    return grouped_content


def process_batch_output(file_path, item_id_filter=""):
    grouped_content = {}
    filtered_content = {}

    with open(file_path, 'r') as file:
        for line in file:
            data = json.loads(line)
            # Extract 'custom_id', split it, and use the first part as a key
            if 'custom_id' in data:
                key_id = data['custom_id'].split('-')[0]
                if 'response' in data and 'body' in data['response'] and 'choices' in data['response']['body']:
                    for choice in data['response']['body']['choices']:
                        if 'message' in choice and 'content' in choice['message']:
                            if key_id not in grouped_content:
                                grouped_content[key_id] = []
                            grouped_content[key_id].append(ast.literal_eval(choice['message']['content']))
    # Code to process the data
    merged_data = {}

    for k, v in grouped_content.items():
        if len(v) > 1:
            # Merge 'subheadings' from all items in v
            merged_subheadings = []
            for item in v:
                merged_subheadings.extend(item['subheadings'])
            # Create a single item with the merged 'subheadings'
            merged_data[k] = [{'subheadings': merged_subheadings}]
        else:
            # Keep the data as is
            merged_data[k] = v

            # another_grouped.append({k:{"subhheadings":more_dicts}})
    print(merged_data)
    # Filter and convert content by the specified key (item_id_filter)
    if item_id_filter == "":
        return merged_data
    if item_id_filter in grouped_content:
        filtered_content[item_id_filter] = []
        for entry in grouped_content[item_id_filter]:
            try:
                # Safely evaluate the string content into a Python dictionary
                parsed_entry = ast.literal_eval(entry)
                filtered_content[item_id_filter].append(parsed_entry)
            except (SyntaxError, ValueError) as e:
                print(f"Error parsing entry for {item_id_filter}: {e}")

    return filtered_content[item_id_filter]


def save_batch_object(directory, batch_object):
    # Ensure the directory exists
    if not os.path.exists(directory):
        os.makedirs(directory)

    # Define the file path
    file_path = os.path.join(directory, 'batch_objects.json')

    # Load existing batch objects if the file exists
    if os.path.exists(file_path):
        with open(file_path, 'r') as file:
            batch_objects = json.load(file)
    else:
        batch_objects = []

    # Append the new batch object
    batch_objects.append(batch_object)

    # Save the batch objects back to the file
    with open(file_path, 'w') as file:
        json.dump(batch_objects, file, indent=4)


def get_batch_ids(directory=r"C:\Users\luano\Downloads\AcAssitant\Batching_files"):
    # Define the file path
    file_path = os.path.join(directory, 'batch_objects.json')

    # Load and return the last batch object if the file exists
    if os.path.exists(file_path):
        with open(file_path, 'r') as file:
            batch_objects = json.load(file)
            if batch_objects:
                return batch_objects[-1]
    return None


def read_or_download_batch_output(batch_id, directory=r"C:\Users\luano\Downloads\AcAssitant\Batching_files"):
    """
    Checks for the existence of an output.jsonl file, reads it if present, or downloads it if the batch is completed.

    Args:
    - file_name (str): The base file name of the batch job.
    - directory (str): Directory where batch files are stored.

    Returns:
    - str: Path to the batch output file.
    """
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    output_file_path = os.path.join(directory, f"{batch_id}_output.jsonl")

    if not os.path.exists(output_file_path):
        # Retrieve the batch status
        batch_object = client.batches.retrieve(batch_id)

        if batch_object.status == 'completed':
            output_file_id = batch_object.output_file_id
            file_response = client.files.retrieve_content(output_file_id)
            # Write the binary content to a file
            with open(output_file_path, 'w', encoding='utf-8') as output_file:
                output_file.write(file_response)
            print(f"[INFO] Downloaded batch output to {output_file_path}")
        else:
            print(f"[INFO] Batch {batch_id} status is {batch_object.status}. Output not ready.")
            return None

    return output_file_path

#
# def process_pdf(file_path, prompt, reference=None, page_parsing=1, batch=False, id="", tag="tag", store_only=False,
#                 collection=""):
#     pages_text = extract_text_from_pdf(file_path.replace("docx", "pdf"))
#
#     combined_response = ""
#     client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
#     batch_requests = []
#
#     for i in range(0, len(pages_text), page_parsing):
#
#         chunk_text = " ".join(pages_text[i:i + page_parsing])
#         text_to_send = f"{prompt}\n\ntext: {chunk_text}"
#
#         if batch or store_only:
#             batch_request = prepare_batch_requests(text_to_send=text_to_send, index=i // page_parsing, id=id, tag=tag)
#             batch_requests.append(batch_request)
#         else:
#             response_content, chat_id = call_openai_api(client, text_to_send)
#             if reference:
#                 response_content = response_content.replace("</blockquote>",
#                                                             f"{reference.replace(')', f' p.{i + 1})')}</blockquote>")
#             combined_response += response_content
#
#     if store_only:
#         file_name = rf"C:\Users\luano\Downloads\AcAssitant\Batching_files\{collection}batch.jsonl"
#         write_batch_requests_to_file(batch_requests, file_name)
#         print(f"[DEBUG] Stored batch requests locally in {file_name}")
#         return None  # Return None as we are storing only
#     if batch:
#         upload_batch_file()
#
#     return combined_response if not batch else batch_requests


def normalize_text(text):
    return re.sub(r'\s+', ' ', text).lower().strip()


def escape_special_characters(section):
    section = re.escape(section).replace(r'\ ', r'\s+')
    return section


def extract_sections(file_path, sections):
    # Initialize the text variable
    text = ''

    # Check the file extension and read the file accordingly
    if file_path.endswith('.pdf'):
        # Read the PDF
        with open(file_path, 'rb') as file:
            reader = PyPDF2.PdfReader(file)
            for page in range(len(reader.pages)):
                text += reader.pages[page].extract_text()
    elif file_path.endswith('.docx'):
        # Read the DOCX
        doc = docx.Document(file_path)
        for paragraph in doc.paragraphs:
            text += paragraph.text + '\n'
    else:
        raise ValueError("Unsupported file type. Only PDF and DOCX files are supported.")

    # Normalize the text
    text = normalize_text(text)

    # Normalize the section names
    sections = [normalize_text(section) for section in sections]

    # Initialize the dictionary to store sections and their text
    section_texts = {section: None for section in sections}

    # Generate the regex pattern for splitting text into sections
    split_pattern = '|'.join([escape_special_characters(section) for section in sections])
    split_pattern = f"({split_pattern})"

    # Split the text into sections
    parts = re.split(split_pattern, text)

    # Assign the body text to the corresponding sections
    for i in range(1, len(parts), 2):
        section_name = parts[i].strip()
        body_text = parts[i + 1].strip() if (i + 1) < len(parts) else ''
        section_texts[section_name] = body_text

    # Print sections that failed to get a body text
    for section, body_text in section_texts.items():
        if not body_text:
            print(f"Section '{section}' failed to get a body text.")

    return section_texts


def process_document_sections(file_path, sections):
    section_texts = extract_sections(file_path, sections)
    chat_id = None
    combined_response = ""
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    for section, body_text in section_texts.items():
        if body_text:
            html_section = f"<h2>{section}</h2>"
            html_body_text = f"<p>{body_text}</p>"
            text_to_send = html_section + html_body_text
            prompt = f"Read the provided PDF carefully, paragraph by paragraph, and perform an in-depth section analysis of the section: '{section}' in the attached PDF document. Carefully count each paragraph. For each key finding/idea, reference the specific paragraph numbers (e.g., 'Paragraph 1,' 'Paragraphs 2,3') accompanied by the respective paragraph(s) with direct quotes enclosed by strong tags to illustrate or support the key. Follow this structure: ```html <h3>Paragraph 1 - [key finding in one short sentence]</h3> <blockquote>'<strong>[first paragraph and statement enclosed by strong tags in the form of a full sentence. The paragraph should be exactly as it is in the text, strictly unmodified. Before using it, check for a full match between the sentence and the text]</strong>'</blockquote> <h3>Paragraphs 2,3 - [Next key finding or idea in one short sentence]</h3> <blockquote>'<strong>[second paragraph and statement enclosed by strong tags in the form of a full sentence. The paragraph should be exactly as it is in the text, strictly unmodified. Before using it, check for a full match between the sentence and the text]</strong>'</blockquote> <blockquote>'<strong>[Direct quote from paragraph 3]</strong>'</blockquote> [Continue this structure for additional paragraphs or groups of paragraphs, correlating each with its key findings or ideas until the end of the section]``` This methodical approach ensures a structured and precise examination of the section: '{section}', organized by the specific paragraphs and their associated key findings or ideas, all supported by direct quotations from the document for a comprehensive and insightful analysis until the end of the provided section. Take your time, and review the final output for accuracy and consistency in HTML formatting and citation-context alignment. note1: Output format: HTML in a code block."
            text_to_send = f"{prompt}\n\ntext: {body_text}"
            response_content, chat_id = call_openai_api(client, text_to_send, chat_id)
            combined_response += html_section + response_content
    return combined_response


def creating_batch_from_pdf(file_path, prompt, reference=None, page_parsing=1, batch=False, id="", tag="tag",
                            store_only=False, file_name=""):
    pages_text = extract_text_from_pdf(file_path.replace("docx", "pdf"))

    combined_response = ""
    batch_requests = []

    for i in range(0, len(pages_text), page_parsing):

        chunk_text = " ".join(pages_text[i:i + page_parsing])
        text_to_send = f"{prompt}\n\nText: {chunk_text}"

        if batch or store_only:
            batch_request = prepare_batch_requests(text_to_send=text_to_send, index=i // page_parsing, id=id, tag=tag)
            batch_requests.append(batch_request)
        else:
            response_content, chat_id = call_openai_api(text_to_send)
            if reference:
                response_content = response_content.replace("</blockquote>",
                                                            f"{reference.replace(')', f' p.{i + 1})')}</blockquote>")
            combined_response += response_content

    if store_only:
        write_batch_requests_to_file(batch_requests, file_name)
        print(f"[DEBUG] Stored batch requests locally in {file_name}")
        # Return None as we are storing only
    # if batch and batch_requests and not store_only:
    #     file_name = write_batch_requests_to_file(batch_requests,
    #                                              file_name=file_name)
    #     batch_input_file_id = upload_batch_file(file_name)
    #     batch_id = create_batch(batch_input_file_id)
    #     check_save_batch_status(batch_id)

    return combined_response if not batch else batch_requests



genai = None
genai_types = None
MistralClientLatest = None  # Using newer name convention
ChatMessage = None  # Keep if used internally by older MistralClient
GEMINI_ENABLED = False
MISTRAL_ENABLED = False
OPENAI_ENABLED = False
DEEPSEEK_ENABLED = False  # Assuming DeepSeek uses OpenAI client structure



# --- Gemini ---
if GEMINI_API_KEY:
    try:
        # --- CORRECT Import Statements ---
        from google import genai  # Import the top-level 'genai' from 'google'
        from google.genai import types as genai_types  # Import 'types' from 'google.genai'
        import PIL.Image

        # --- End Correct Imports ---

        # Configure the genai module with the API key right after import
        client = genai.Client(api_key=GEMINI_API_KEY)
        print("Configured google.genai with API key.")

        GEMINI_ENABLED = True
        print("Gemini library (google.genai), Pillow, and API key found and configured.")
    except ImportError:
        print(
            "Warning: 'google.genai' or 'Pillow' library not found. Gemini features disabled. `pip install google-generativeai Pillow`")
        genai = None
        genai_types = None
        PIL = None
        GEMINI_ENABLED = False
    except AttributeError as attr_err:
        # Catch potential issues if 'configure' doesn't exist on the imported 'genai'
        print(f"Warning: Error configuring google.genai (possibly wrong library installed?): {attr_err}")
        genai = None
        genai_types = None
        PIL = None
        GEMINI_ENABLED = False
    except Exception as config_err:
        # Catch other potential configuration errors
        print(f"Warning: Unexpected error during google.genai configuration: {config_err}")
        genai = None
        genai_types = None
        PIL = None
        GEMINI_ENABLED = False

else:
    print("Warning: LU_GEMINI_API_KEY not set. Gemini features disabled.")
    GEMINI_ENABLED = False
    genai = None
    genai_types = None
    PIL = None
# --- Mistral ---
MISTRAL_API_KEY = os.getenv("MISTRAL_API_KEY")


MistralClientLatest = None
ChatMessage = None
MISTRAL_ENABLED = False


# --- Configuration ---
PROMPT_CONFIG_FILE = r"C:\Users\luano\PycharmProjects\all tests\prompts.json"
SCRIPT_DIR = Path(__file__).parent


# --- Helper Functions (encode_image_to_base64, load_prompt_config - assumed correct) ---
def encode_image_to_base64(image_path_or_url):
    """Encodes a local image file or fetches and encodes a URL image to base64."""
    try:
        if image_path_or_url.startswith("http://") or image_path_or_url.startswith("https://"):
            response = requests.get(image_path_or_url, stream=True)
            response.raise_for_status()
            image_bytes = response.content
            content_type = response.headers.get('content-type', 'image/jpeg').lower()
            if 'png' in content_type:
                mime_type = "image/png"
            elif 'gif' in content_type:
                mime_type = "image/gif"
            elif 'webp' in content_type:
                mime_type = "image/webp"
            else:
                mime_type = "image/jpeg"
        else:
            image_path = Path(image_path_or_url)
            if not image_path.is_file():
                print(f"Error: Local image file not found at {image_path}")
                return None, None
            with open(image_path, "rb") as image_file:
                image_bytes = image_file.read()
            ext = image_path.suffix.lower()
            if ext == ".png":
                mime_type = "image/png"
            elif ext == ".gif":
                mime_type = "image/gif"
            elif ext == ".webp":
                mime_type = "image/webp"
            else:
                mime_type = "image/jpeg"
        base64_image = base64.b64encode(image_bytes).decode('utf-8')
        return base64_image, mime_type
    except Exception as e:
        print(f"Error encoding image {image_path_or_url}: {e}")
        return None, None
from pathlib import Path

def _run_ctc_forced_alignment(
    audio_path: Path,
    text: str,
    language: str = "eng",
    batch_size: int = 16,
) -> list[dict[str, object]]:
    """
    ###1. Run ctc-forced-aligner pipeline on (audio_path, text)
    ###2. Guard against targets length > CTC time steps and skip when unsafe
    ###3. Accept both dict and list output from postprocess_results
    ###4. Return [{index, word, start_ms, end_ms}]
    """
    import torch
    from ctc_forced_aligner import (
        load_audio,
        load_alignment_model,
        generate_emissions,
        preprocess_text,
        get_alignments,
        get_spans,
        postprocess_results,
    )

    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if device == "cuda" else torch.float32

    alignment_model, alignment_tokenizer = load_alignment_model(
        device=device,
        dtype=dtype,
    )

    audio_waveform = load_audio(
        str(audio_path),
        alignment_model.dtype,
        alignment_model.device,
    )

    text_clean = text.replace("\n", " ").strip()

    emissions, stride = generate_emissions(
        alignment_model,
        audio_waveform,
        batch_size=batch_size,
    )

    time_steps = int(emissions.shape[0])

    tokens_starred, text_starred = preprocess_text(
        text_clean,
        romanize=True,
        language=language,
    )

    if not tokens_starred:
        print("[CTC][ALIGN] tokens_starred is empty; no alignment possible.")
        return []

    if time_steps <= 0:
        print("[CTC][ALIGN] no time steps in emissions; skipping CTC alignment.")
        return []

    if len(tokens_starred) >= time_steps:
        print(
            "[CTC][ALIGN] tokens length=",
            len(tokens_starred),
            "time_steps=",
            time_steps,
            "→ skipping CTC (targets length is too long for CTC); falling back.",
        )
        return []

    segments_idx, scores, blank_token = get_alignments(
        emissions,
        tokens_starred,
        alignment_tokenizer,
    )

    spans = get_spans(tokens_starred, segments_idx, blank_token)

    result = postprocess_results(
        text_starred,
        spans,
        stride,
        scores,
    )

    segments_out: list[dict[str, object]] = []

    if isinstance(result, dict):
        segs_val = result.get("segments")
        if isinstance(segs_val, list):
            segments_out = segs_val
    elif isinstance(result, list):
        segments_out = result

    print(
        "[CTC][DEBUG]",
        "tokens_starred=",
        len(tokens_starred),
        "spans=",
        len(spans),
        "segments_raw=",
        len(segments_out),
    )

    words: list[dict[str, object]] = []
    duration_ms = 0
    i = 0
    while i < len(segments_out):
        seg = segments_out[i]
        if isinstance(seg, dict):
            token = seg.get("text") or seg.get("word") or ""
            s_val = seg.get("start")
            e_val = seg.get("end")

            if not isinstance(s_val, (int, float)):
                s_val = 0.0
            if not isinstance(e_val, (int, float)):
                e_val = s_val

            s_ms = int(s_val * 1000.0)
            e_ms = int(e_val * 1000.0)

            if s_ms < 0:
                s_ms = 0
            if e_ms < s_ms:
                e_ms = s_ms + 40

            if e_ms > duration_ms:
                duration_ms = e_ms

            words.append(
                {
                    "index": len(words),
                    "word": str(token),
                    "start_ms": s_ms,
                    "end_ms": e_ms,
                }
            )
        i = i + 1

    print(
        "[CTC][ALIGN]",
        "segments_in=",
        len(segments_out),
        "words_out=",
        len(words),
        "duration_ms=",
        duration_ms,
    )

    return words

def _run_ctc_alignment_if_needed(audio_path: Path, text_path: Path) -> None:
    """
    ###1. Use Docker+MFA to align this audio/text pair
    ###2. Write .mfa.json sidecar next to audio_path
    ###3. Compare canonical text vs MFA words and log coverage
    ###4. Persist detailed stats (including unmatched and split tokens) into .mfa.json
    """
    import json
    import sys
    import subprocess
    import tempfile
    import shutil
    from pathlib import Path as _PathAlias, Path

    print("[TTS][MFA] _run_ctc_alignment_if_needed() called (MFA backend)")
    print("[TTS][MFA] sys.executable:", sys.executable)
    print("[TTS][MFA] audio_path:", str(audio_path))
    print("[TTS][MFA] text_path:", str(text_path))

    audio_path = _PathAlias(audio_path)
    text_path = _PathAlias(text_path)

    if not audio_path.is_file():
        print("[TTS][MFA] audio_path does not exist, skipping:", str(audio_path))
        return

    if not text_path.is_file():
        print("[TTS][MFA] text_path does not exist, skipping:", str(text_path))
        return

    if shutil.which("docker") is None:
        print("[TTS][MFA] docker not found on PATH, skipping MFA alignment.")
        return

    suffix = audio_path.suffix.lower()
    if suffix != ".wav":
        print("[TTS][MFA] audio is not WAV, skipping MFA alignment:", suffix)
        return

    align_json_path = audio_path.with_suffix(".mfa.json")
    if align_json_path.is_file():
        print("[TTS][MFA] deleting existing MFA alignment JSON:", str(align_json_path))
        align_json_path.unlink()

    corpus_dir_raw = tempfile.mkdtemp(prefix="mfa_corpus_")
    output_dir_raw = tempfile.mkdtemp(prefix="mfa_output_")

    corpus_dir = _PathAlias(corpus_dir_raw)
    output_dir = _PathAlias(output_dir_raw)

    print("[TTS][MFA] corpus_dir:", str(corpus_dir))
    print("[TTS][MFA] output_dir:", str(output_dir))

    wav_dst = corpus_dir / audio_path.name
    shutil.copy2(str(audio_path), str(wav_dst))

    with text_path.open("r", encoding="utf-8") as f_in:
        text_value = f_in.read().strip()

    lab_dst = corpus_dir / (wav_dst.stem + ".lab")
    with lab_dst.open("w", encoding="utf-8") as f_lab:
        if text_value != "":
            f_lab.write(text_value)
            f_lab.write("\n")

    docker_image = "mmcauliffe/montreal-forced-aligner:latest"

    models_dir_host = Path.home() / "mfa_models"
    models_volume_host = None
    models_volume_container = "/home/mfauser/Documents/MFA"

    if models_dir_host.exists() and models_dir_host.is_dir():
        models_volume_host = str(models_dir_host)
        print("[TTS][MFA] using host MFA models dir:", models_volume_host)
        print("[TTS][MFA] models visible in container at:", models_volume_container)
    else:
        print(
            "[TTS][MFA] warning: models_dir does not exist, MFA will rely on image defaults:",
            str(models_dir_host),
        )

    cmd = [
        "docker",
        "run",
        "--rm",
        "-v",
        str(corpus_dir) + ":/data/corpus",
        "-v",
        str(output_dir) + ":/data/output",
    ]

    if models_volume_host is not None:
        cmd.extend(
            [
                "-v",
                models_volume_host + ":" + models_volume_container,
            ]
        )

    shell_cmd = (
        "set -e;"
        "echo '[MFA-DOCKER] listing existing acoustic models';"
        "mfa model list acoustic || true;"
        "echo '[MFA-DOCKER] listing existing dictionaries';"
        "mfa model list dictionary || true;"
        "if ! mfa model list acoustic | grep -q 'english_mfa'; then "
        "  echo '[MFA-DOCKER] downloading acoustic model english_mfa';"
        "  mfa model download acoustic english_mfa;"
        "fi;"
        "if ! mfa model list dictionary | grep -q 'english_us_mfa'; then "
        "  echo '[MFA-DOCKER] downloading dictionary english_us_mfa';"
        "  mfa model download dictionary english_us_mfa;"
        "fi;"
        "echo '[MFA-DOCKER] running mfa align';"
        "mfa align /data/corpus english_us_mfa english_mfa /data/output --output_format json"
    )

    cmd.extend(
        [
            docker_image,
            "bash",
            "-lc",
            shell_cmd,
        ]
    )

    print("[TTS][MFA] running Docker MFA alignment command:")
    print("[TTS][MFA] ", " ".join(cmd))

    result = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
    )

    print("=== [TTS][MFA] docker STDOUT ===")
    if isinstance(result.stdout, str) and result.stdout != "":
        print(result.stdout)
    print("=== [TTS][MFA] docker STDERR ===")
    if isinstance(result.stderr, str) and result.stderr != "":
        print(result.stderr)

    if result.returncode != 0:
        print("[TTS][MFA] docker MFA command failed, return code:", result.returncode)
        shutil.rmtree(corpus_dir, ignore_errors=True)
        shutil.rmtree(output_dir, ignore_errors=True)
        return

    mfa_json_candidate = output_dir / (audio_path.stem + ".json")
    if not mfa_json_candidate.is_file():
        json_files = list(output_dir.glob("*.json"))
        if not json_files:
            print("[TTS][MFA] no MFA JSON output found in:", str(output_dir))
            shutil.rmtree(corpus_dir, ignore_errors=True)
            shutil.rmtree(output_dir, ignore_errors=True)
            return
        mfa_json_candidate = json_files[0]

    print("[TTS][MFA] using MFA JSON file:", str(mfa_json_candidate))

    with mfa_json_candidate.open("r", encoding="utf-8") as f_json:
        ext_raw = json.load(f_json)

    print("[TTS][MFA][DEBUG] top-level JSON type:", type(ext_raw).__name__)
    if isinstance(ext_raw, dict):
        keys_list = list(ext_raw.keys())
        print("[TTS][MFA][DEBUG] top-level dict keys (first 10):", keys_list[:10])
    elif isinstance(ext_raw, list):
        print("[TTS][MFA][DEBUG] top-level list length:", len(ext_raw))

    def _extract_from_textgrid_dict(tg_dict):
        segments = []
        if not isinstance(tg_dict, dict):
            return segments
        tiers_val = tg_dict.get("tiers")
        if not isinstance(tiers_val, list):
            return segments

        tier_names = []
        idx_t = 0
        while idx_t < len(tiers_val):
            tier_item = tiers_val[idx_t]
            idx_t = idx_t + 1
            if isinstance(tier_item, dict):
                name_val = tier_item.get("name")
                if isinstance(name_val, str):
                    tier_names.append(name_val)
        print("[TTS][MFA][DEBUG] tiers present:", tier_names)

        word_tier = None
        idx_t = 0
        while idx_t < len(tiers_val):
            tier_item = tiers_val[idx_t]
            idx_t = idx_t + 1
            if not isinstance(tier_item, dict):
                continue
            name_val = tier_item.get("name")
            name_norm = name_val.lower() if isinstance(name_val, str) else ""
            if name_norm in {"words", "word", "orthography"}:
                word_tier = tier_item
                break
        if word_tier is None and len(tiers_val) > 0:
            word_tier = tiers_val[0]
            print("[TTS][MFA][DEBUG] no explicit word tier, using first tier as fallback")

        if not isinstance(word_tier, dict):
            return segments

        items = word_tier.get("items")
        if not isinstance(items, list):
            items = word_tier.get("intervals")
        if not isinstance(items, list):
            items = word_tier.get("entries")
        if not isinstance(items, list):
            print("[TTS][MFA][DEBUG] selected tier has no items/intervals/entries list")
            return segments

        print("[TTS][MFA][DEBUG] word-tier items len:", len(items))

        idx_item = 0
        while idx_item < len(items):
            item = items[idx_item]
            idx_item = idx_item + 1

            start_val = None
            end_val = None
            label_val = None

            if isinstance(item, dict):
                label_val = item.get("label")
                if not isinstance(label_val, str):
                    label_val = item.get("text")
                if not isinstance(label_val, str):
                    label_val = item.get("orthography")
                if not isinstance(label_val, str):
                    label_val = item.get("word")

                start_val = item.get("start")
                end_val = item.get("end")
                if not isinstance(start_val, (int, float)):
                    start_val = item.get("begin")
                if not isinstance(end_val, (int, float)):
                    end_val = item.get("stop")
                if not isinstance(start_val, (int, float)):
                    start_val = item.get("xmin")
                if not isinstance(end_val, (int, float)):
                    end_val = item.get("xmax")
                if not isinstance(start_val, (int, float)):
                    start_ms_val = item.get("start_ms")
                    if isinstance(start_ms_val, (int, float)):
                        start_val = float(start_ms_val) / 1000.0
                if not isinstance(end_val, (int, float)):
                    end_ms_val = item.get("end_ms")
                    if isinstance(end_ms_val, (int, float)):
                        end_val = float(end_ms_val) / 1000.0
            elif isinstance(item, list) and len(item) >= 3:
                start_val = item[0]
                end_val = item[1]
                label_val = item[2]

            segments.append(
                {
                    "start": start_val,
                    "end": end_val,
                    "label": label_val,
                }
            )

        print("[TTS][MFA][DEBUG] extracted segments from word tier:", len(segments))
        if segments:
            max_preview = 5
            preview = segments[:max_preview]
            print("[TTS][MFA][DEBUG] first", max_preview, "segments preview:", preview)
        return segments

    def _normalise_mfa_segments(raw_value):
        print("[TTS][MFA][DEBUG] entering _normalise_mfa_segments, node type:", type(raw_value).__name__)

        if isinstance(raw_value, dict):
            if "tiers" in raw_value:
                print("[TTS][MFA][DEBUG] dict with 'tiers' found at this level")
                segs = _extract_from_textgrid_dict(raw_value)
                if segs:
                    return segs

            values_list = list(raw_value.values())
            idx_v = 0
            while idx_v < len(values_list):
                val = values_list[idx_v]
                idx_v = idx_v + 1
                if isinstance(val, dict) and "tiers" in val:
                    print("[TTS][MFA][DEBUG] nested dict with 'tiers' found")
                    segs = _extract_from_textgrid_dict(val)
                    if segs:
                        return segs

            values_list = list(raw_value.values())
            idx_v = 0
            while idx_v < len(values_list):
                val = values_list[idx_v]
                idx_v = idx_v + 1
                segs = _normalise_mfa_segments(val)
                if segs:
                    return segs
            return []

        if isinstance(raw_value, list):
            if len(raw_value) > 0:
                first_item = raw_value[0]
                print(
                    "[TTS][MFA][DEBUG] list node, len=",
                    len(raw_value),
                    "first item type:",
                    type(first_item).__name__,
                )
            idx_l = 0
            while idx_l < len(raw_value):
                item = raw_value[idx_l]
                idx_l = idx_l + 1
                if (
                    isinstance(item, list)
                    and len(item) >= 3
                    and isinstance(item[0], (int, float))
                    and isinstance(item[1], (int, float))
                    and isinstance(item[2], str)
                ):
                    segments = []
                    idx_trip = 0
                    while idx_trip < len(raw_value):
                        trip = raw_value[idx_trip]
                        idx_trip = idx_trip + 1
                        if not isinstance(trip, list) or len(trip) < 3:
                            continue
                        start_val = trip[0]
                        end_val = trip[1]
                        label_val = trip[2]
                        segments.append(
                            {
                                "start": start_val,
                                "end": end_val,
                                "label": label_val,
                            }
                        )
                    print("[TTS][MFA][DEBUG] list-of-triplets segments:", len(segments))
                    if segments:
                        max_preview = 5
                        print(
                            "[TTS][MFA][DEBUG] preview list-of-triplets segments:",
                            segments[:max_preview],
                        )
                    return segments
                if isinstance(item, dict) or isinstance(item, list):
                    segs = _normalise_mfa_segments(item)
                    if segs:
                        return segs
            return []

        return []

    segments = _normalise_mfa_segments(ext_raw)

    if not segments:
        print("[TTS][MFA] MFA JSON could not be normalised into segments.")
        try_dump = json.dumps(ext_raw)
        max_len_dump = 1000
        if len(try_dump) > max_len_dump:
            print("[TTS][MFA][DEBUG] raw MFA JSON (truncated):", try_dump[:max_len_dump], "...[truncated]")
        else:
            print("[TTS][MFA][DEBUG] raw MFA JSON:", try_dump)
        shutil.rmtree(corpus_dir, ignore_errors=True)
        shutil.rmtree(output_dir, ignore_errors=True)
        return

    print("[TTS][MFA][DEBUG] total segments normalised:", len(segments))

    words_aligned = []
    duration_ms_aligned = 0
    idx_word = 0

    idx_seg = 0
    while idx_seg < len(segments):
        seg = segments[idx_seg]
        idx_seg = idx_seg + 1
        if not isinstance(seg, dict):
            continue

        label_val = seg.get("label")
        if not isinstance(label_val, str):
            continue

        text_clean = label_val.strip()
        if text_clean == "":
            continue
        lower_val = text_clean.lower()

        if lower_val in {"sil", "<eps>", "sp", "spn", "<unk>"}:
            continue
        if text_clean.startswith("[") and text_clean.endswith("]"):
            continue

        start_val = seg.get("start")
        end_val = seg.get("end")

        if isinstance(start_val, (int, float)):
            start_ms = int(float(start_val) * 1000.0)
        else:
            start_ms = 0

        if isinstance(end_val, (int, float)):
            end_ms = int(float(end_val) * 1000.0)
        else:
            end_ms = start_ms

        if start_ms < 0:
            start_ms = 0
        if end_ms < start_ms:
            end_ms = start_ms

        if end_ms > duration_ms_aligned:
            duration_ms_aligned = end_ms

        words_aligned.append(
            {
                "index": idx_word,
                "word": text_clean,
                "start_ms": start_ms,
                "end_ms": end_ms,
            }
        )
        idx_word = idx_word + 1

    print("[TTS][MFA][DEBUG] words_aligned count:", len(words_aligned))

    if not words_aligned:
        print("[TTS][MFA] MFA alignment produced no word segments after normalisation.")
        shutil.rmtree(corpus_dir, ignore_errors=True)
        shutil.rmtree(output_dir, ignore_errors=True)
        return

    max_word_preview = 10
    print("[TTS][MFA][DEBUG] first", max_word_preview, "aligned words:", words_aligned[:max_word_preview])

    def _normalise_token(token_value: str) -> str:
        chars = []
        idx_char = 0
        low = token_value.lower()
        while idx_char < len(low):
            ch = low[idx_char]
            if ch.isalnum():
                chars.append(ch)
            idx_char = idx_char + 1
        return "".join(chars)

    def _segment_token_by_vocab(token_norm, vocab_set):
        segments = None
        length = len(token_norm)
        if length < 4:
            return segments
        split_pos = 1
        while split_pos < length:
            left = token_norm[:split_pos]
            right = token_norm[split_pos:]
            if left in vocab_set and right in vocab_set:
                segments = [left, right]
                return segments
            split_pos = split_pos + 1
        return segments

    canon_source = text_value if isinstance(text_value, str) else ""
    canon_tokens_raw = canon_source.split()
    canon_tokens = []
    idx_ct = 0
    while idx_ct < len(canon_tokens_raw):
        t = canon_tokens_raw[idx_ct]
        idx_ct = idx_ct + 1
        if t.strip() == "":
            continue
        if t.startswith("[") and t.endswith("]"):
            continue
        canon_tokens.append(t)

    print("[TTS][MFA][DEBUG] canonical tokens count:", len(canon_tokens))

    aligned_tokens = []
    idx_w = 0
    while idx_w < len(words_aligned):
        w_item = words_aligned[idx_w]
        idx_w = idx_w + 1
        w_text = w_item.get("word")
        if isinstance(w_text, str):
            parts = w_text.split()
            idx_p = 0
            while idx_p < len(parts):
                part_val = parts[idx_p]
                idx_p = idx_p + 1
                if part_val.strip() != "":
                    aligned_tokens.append(part_val)

    print("[TTS][MFA][DEBUG] aligned tokens count:", len(aligned_tokens))

    aligned_norm = []
    idx_an = 0
    while idx_an < len(aligned_tokens):
        norm_val = _normalise_token(aligned_tokens[idx_an])
        idx_an = idx_an + 1
        if norm_val != "":
            aligned_norm.append(norm_val)

    aligned_norm_set = set(aligned_norm)

    canon_norm = []
    split_canon_records = []
    idx_ct = 0
    while idx_ct < len(canon_tokens):
        raw_tok = canon_tokens[idx_ct]
        idx_ct = idx_ct + 1
        norm_val = _normalise_token(raw_tok)
        if norm_val == "":
            continue
        if norm_val in aligned_norm_set:
            canon_norm.append(norm_val)
            continue
        segs = _segment_token_by_vocab(norm_val, aligned_norm_set)
        if segs is not None:
            canon_norm.extend(segs)
            split_canon_records.append(
                {
                    "original": raw_tok,
                    "norm": norm_val,
                    "segments": segs,
                }
            )
        else:
            canon_norm.append(norm_val)

    print("[TTS][MFA][DEBUG] canon_norm len:", len(canon_norm))
    print("[TTS][MFA][DEBUG] aligned_norm len:", len(aligned_norm))
    print("[TTS][MFA][DEBUG] split canonical fusings count:", len(split_canon_records))
    if len(split_canon_records) > 0:
        max_split_preview = 10
        print(
            "[TTS][MFA][DEBUG] split canonical fusings (preview):",
            split_canon_records[:max_split_preview],
        )

    canon_len = len(canon_norm)
    aligned_len = len(aligned_norm)

    canon_counts = {}
    idx_c = 0
    while idx_c < canon_len:
        tok = canon_norm[idx_c]
        idx_c = idx_c + 1
        prev = canon_counts.get(tok)
        if prev is None:
            canon_counts[tok] = 1
        else:
            canon_counts[tok] = prev + 1

    aligned_counts = {}
    idx_a = 0
    while idx_a < aligned_len:
        tok = aligned_norm[idx_a]
        idx_a = idx_a + 1
        prev = aligned_counts.get(tok)
        if prev is None:
            aligned_counts[tok] = 1
        else:
            aligned_counts[tok] = prev + 1

    matched = 0
    for tok in canon_counts:
        c_count = canon_counts[tok]
        a_count = aligned_counts.get(tok)
        if isinstance(a_count, int):
            if a_count < c_count:
                matched = matched + a_count
            else:
                matched = matched + c_count

    aligned_norm_set = set(aligned_norm)
    canon_norm_set = set(canon_norm)

    unmatched_canon = []
    idx_c = 0
    while idx_c < len(canon_norm):
        tok = canon_norm[idx_c]
        idx_c = idx_c + 1
        if tok not in aligned_norm_set:
            unmatched_canon.append(tok)
        if len(unmatched_canon) >= 20:
            break

    unmatched_aligned = []
    idx_a = 0
    while idx_a < len(aligned_norm):
        tok = aligned_norm[idx_a]
        idx_a = idx_a + 1
        if tok not in canon_norm_set:
            unmatched_aligned.append(tok)
        if len(unmatched_aligned) >= 20:
            break

    print("[TTS][MFA][DEBUG] unique canon_norm tokens:", len(canon_norm_set))
    print("[TTS][MFA][DEBUG] unique aligned_norm tokens:", len(aligned_norm_set))
    print("[TTS][MFA][DEBUG] sample unmatched canonical tokens:", unmatched_canon)
    print("[TTS][MFA][DEBUG] sample unmatched aligned tokens:", unmatched_aligned)

    match_pct_canonical = 0.0
    if canon_len > 0:
        match_pct_canonical = 100.0 * float(matched) / float(canon_len)

    match_pct_aligned = 0.0
    if aligned_len > 0:
        match_pct_aligned = 100.0 * float(matched) / float(aligned_len)

    diff_pct_canonical = 100.0 - match_pct_canonical
    diff_pct_aligned = 100.0 - match_pct_aligned

    print(
        "[TTS][MFA][COMPARE]",
        "canon_tokens=",
        canon_len,
        "aligned_tokens=",
        aligned_len,
        "matched(multiset)=",
        matched,
        "match_pct_canonical=",
        match_pct_canonical,
        "diff_pct_canonical=",
        diff_pct_canonical,
        "match_pct_aligned=",
        match_pct_aligned,
        "diff_pct_aligned=",
        diff_pct_aligned,
    )

    alignment_payload = {
        "words": words_aligned,
        "duration_ms": int(duration_ms_aligned),
        "model_label": "mfa",
        "stats": {
            "canon_tokens": canon_len,
            "aligned_tokens": aligned_len,
            "matched_tokens": matched,
            "match_pct_canonical": match_pct_canonical,
            "diff_pct_canonical": diff_pct_canonical,
            "match_pct_aligned": match_pct_aligned,
            "diff_pct_aligned": diff_pct_aligned,
            "unique_canon_tokens": len(canon_norm_set),
            "unique_aligned_tokens": len(aligned_norm_set),
            "sample_unmatched_canonical": unmatched_canon,
            "sample_unmatched_aligned": unmatched_aligned,
            "split_canonical_fusings": split_canon_records,
        },
    }

    with align_json_path.open("w", encoding="utf-8") as f_align:
        json.dump(alignment_payload, f_align, ensure_ascii=False, indent=2)

    print(
        "[TTS][MFA] wrote alignment JSON:",
        str(align_json_path),
        "words=",
        len(words_aligned),
        "duration_ms=",
        int(duration_ms_aligned),
    )

    shutil.rmtree(corpus_dir, ignore_errors=True)
    shutil.rmtree(output_dir, ignore_errors=True)




from pathlib import Path
from typing import  Optional
def _run_alignment_and_metadata(
    audio_path: Path,
    original_text: str,
    *,
    meta_path: Path,
    placeholder_meta: Optional[dict],
    section_id: str,
    voice: str,
    voice_instructions: str,
    model: str,
    aligner: str = "ctc",
) -> None:
    """
    ###1. Write canonical text for aligner
    ###2. If aligner=='ctc', run ctc-forced-aligner into .align.json
    ###3. Else run Docker+MFA into .mfa.json
    ###4. Build fresh metadata JSON every time
    ###5. Persist meta['tts_text'] as the canonical spoken text (single source of truth)
    """
    import hashlib

    canonical_text = str(original_text).replace("\u2029", " ").replace("\u2028", " ").strip()
    if canonical_text == "":
        canonical_text = str(original_text)

    text_hash = hashlib.sha1(canonical_text.encode("utf-8")).hexdigest()[:10]

    mfa_text_path = audio_path.with_suffix(".mfa.txt")
    mfa_text_path.parent.mkdir(parents=True, exist_ok=True)
    with mfa_text_path.open("w", encoding="utf-8") as f_mfa_text:
        f_mfa_text.write(canonical_text)
        if not canonical_text.endswith("\n"):
            f_mfa_text.write("\n")

    aligner_lower = str(aligner).strip().lower()

    if aligner_lower == "ctc":
        import json

        print("[TTS][CTC] running ctc-forced-aligner backend for alignment")
        words_ctc = _run_ctc_forced_alignment(audio_path, canonical_text)

        if words_ctc:
            max_end = 0
            idx = 0
            while idx < len(words_ctc):
                w_item = words_ctc[idx]
                e_val = w_item.get("end_ms")
                if type(e_val) is int and e_val > max_end:
                    max_end = e_val
                idx = idx + 1

            alignment_payload = {
                "words": words_ctc,
                "duration_ms": int(max_end),
                "model_label": "ctc",
                "tts_text": canonical_text,
                "text_hash": text_hash,
            }
            align_path = audio_path.with_suffix(".align.json")
            with align_path.open("w", encoding="utf-8") as f_align:
                json.dump(alignment_payload, f_align, ensure_ascii=False, indent=2)

            print(
                "[TTS][CTC] wrote CTC alignment JSON:",
                str(align_path),
                "words=",
                len(words_ctc),
                "duration_ms=",
                int(max_end),
            )
        else:
            print("[TTS][CTC] CTC forced alignment produced no words; falling back to Whisper/proportional timings.")
    else:
        _run_ctc_alignment_if_needed(audio_path, mfa_text_path)

    _build_metadata(
        audio_path=audio_path,
        original_text=canonical_text,
        meta_path=meta_path,
        placeholder_meta=placeholder_meta,
        section_id=section_id,
        voice=voice,
        voice_instructions=voice_instructions,
        model=model,
        text_hash=text_hash,
    )



def _build_metadata(
    audio_path: Path,
    original_text: str,
    *,
    meta_path: Path,
    placeholder_meta: Optional[dict],
    section_id: str,
    voice: str,
    voice_instructions: str,
    model: str,
    text_hash: str,
) -> None:
    """
    ###1. Measure WAV duration
    ###2. Prefer external forced aligners (MFA/Gentle/align.json) when present
    ###3. For MFA, project timings onto canonical tokens (including [H_/P_/A_] markers)
    ###4. Otherwise run Whisper or proportional timings over canonical text
    ###5. Persist word-level timings with alignment_version=4
    """
    import wave
    import json
    import re

    print("[TTS][META] building metadata for:", str(audio_path))

    text_clean = original_text.replace("\u2029", " ").replace("\u2028", " ")
    text_clean = text_clean.strip()

    duration_ms = 0
    duration_s = 0.0
    audio_duration_ms = 0
    audio_duration_s = 0.0
    file_size_bytes = 0
    suffix = audio_path.suffix.lower()

    if audio_path.exists():
        stat_info = audio_path.stat()
        file_size_bytes = stat_info.st_size
        if suffix == ".wav":
            wf = wave.open(str(audio_path), "rb")
            frames = wf.getnframes()
            rate = wf.getframerate()
            channels = wf.getnchannels()
            sampwidth = wf.getsampwidth()
            wf.close()
            if rate > 0:
                audio_duration_s = float(frames) / float(rate)
                audio_duration_ms = int(audio_duration_s * 1000.0)
                duration_s = audio_duration_s
                duration_ms = audio_duration_ms
            print(
                "[TTS][META][AUDIO]",
                "rate_hz=",
                rate,
                "channels=",
                channels,
                "sampwidth_bytes=",
                sampwidth,
                "frames=",
                frames,
                "audio_duration_ms=",
                audio_duration_ms,
            )
        else:
            print("[TTS][META][AUDIO] non-WAV suffix:", suffix, "size_bytes:", file_size_bytes)
    else:
        print("[TTS][META][AUDIO] audio path does not exist:", str(audio_path))

    existing_ok = False
    meta_existing: Dict[str, Any] | None = None

    if meta_path.exists():
        size_existing = meta_path.stat().st_size
        if size_existing > 0:
            with meta_path.open("r", encoding="utf-8") as f_meta_existing:
                meta_existing = json.load(f_meta_existing)
            if isinstance(meta_existing, dict):
                existing_duration_ms = int(meta_existing.get("duration_ms", 0))
                existing_hash = meta_existing.get("text_hash")
                existing_version = meta_existing.get("alignment_version", 0)
                print(
                    "[TTS][META] existing sidecar:",
                    str(meta_path),
                    "existing_duration_ms=",
                    existing_duration_ms,
                    "audio_duration_ms=",
                    audio_duration_ms,
                    "existing_text_hash=",
                    existing_hash,
                    "current_text_hash=",
                    text_hash,
                    "alignment_version=",
                    existing_version,
                )
                if (
                    audio_duration_ms > 0
                    and existing_duration_ms > 0
                    and existing_hash == text_hash
                    and existing_version == 4
                ):
                    delta = existing_duration_ms - audio_duration_ms
                    if delta < 0:
                        delta = 0 - delta
                    print("[TTS][META] existing vs audio delta_ms:", delta)
                    if delta <= 10:
                        print("[TTS][META] existing metadata matches audio, keeping.")
                        existing_ok = True

    def _load_external_alignment(audio_path_value: Path, audio_duration_value_ms: int) -> Dict[str, Any] | None:
        """
        ###1. Load external alignment JSON (.align/.gentle/.mfa)
        ###2. For MFA, only accept if word-level match is good enough
        ###3. Return None to keep Whisper timings when MFA is phonetic-only
        """
        candidates = [
            (audio_path_value.with_suffix(".align.json"), "external-align"),
            (audio_path_value.with_suffix(".gentle.json"), "gentle"),
            (audio_path_value.with_suffix(".mfa.json"), "mfa"),
        ]

        idx_candidate = 0
        while idx_candidate < len(candidates):
            candidate_path, label = candidates[idx_candidate]
            if candidate_path.is_file():
                print(
                    "[TTS][META][EXT] loading external alignment:",
                    str(candidate_path),
                    "label=",
                    label,
                )
                with candidate_path.open("r", encoding="utf-8") as f_ext:
                    ext_raw = json.load(f_ext)

                ext_words = None
                ext_duration_ms = 0
                match_pct_canonical = None

                if isinstance(ext_raw, dict):
                    words_val = ext_raw.get("words")
                    if isinstance(words_val, list):
                        ext_words = words_val
                    dur_val = ext_raw.get("duration_ms")
                    if isinstance(dur_val, (int, float)):
                        ext_duration_ms = int(dur_val)
                    stats_val = ext_raw.get("stats")
                    if isinstance(stats_val, dict):
                        mpc_val = stats_val.get("match_pct_canonical")
                        if isinstance(mpc_val, (int, float)):
                            match_pct_canonical = float(mpc_val)
                elif isinstance(ext_raw, list):
                    ext_words = ext_raw

                if label == "mfa":
                    if match_pct_canonical is not None:
                        print(
                            "[TTS][META][EXT-MFA] match_pct_canonical=",
                            match_pct_canonical,
                        )
                        if match_pct_canonical < 50.0:
                            print(
                                "[TTS][META][EXT-MFA] low canonical match, ignoring MFA and keeping Whisper timings."
                            )
                            return None

                if isinstance(ext_words, list) and ext_words:
                    words_forced: List[Dict[str, Any]] = []
                    j = 0
                    while j < len(ext_words):
                        w_item = ext_words[j]
                        if isinstance(w_item, dict):
                            w_token = w_item.get("word")
                            s_val = w_item.get("start_ms")
                            e_val = w_item.get("end_ms")

                            if not isinstance(s_val, (int, float)):
                                s_alt = w_item.get("start")
                                if isinstance(s_alt, (int, float)):
                                    s_val = s_alt * 1000.0
                            if not isinstance(e_val, (int, float)):
                                e_alt = w_item.get("end")
                                if isinstance(e_alt, (int, float)):
                                    e_val = e_alt * 1000.0

                            if not isinstance(s_val, (int, float)):
                                s_val = 0.0
                            if not isinstance(e_val, (int, float)):
                                e_val = s_val

                            s_ms = int(s_val)
                            e_ms = int(e_val)

                            if s_ms < 0:
                                s_ms = 0
                            if e_ms < s_ms:
                                e_ms = s_ms + 40
                            if audio_duration_value_ms > 0 and e_ms > audio_duration_value_ms:
                                e_ms = audio_duration_value_ms

                            words_forced.append(
                                {
                                    "index": len(words_forced),
                                    "word": w_token if isinstance(w_token, str) else "",
                                    "start_ms": s_ms,
                                    "end_ms": e_ms,
                                }
                            )
                        j = j + 1

                    if ext_duration_ms <= 0 and words_forced:
                        last_end_val = words_forced[-1].get("end_ms", 0)
                        if isinstance(last_end_val, int) and last_end_val > 0:
                            ext_duration_ms = last_end_val

                    if ext_duration_ms <= 0:
                        ext_duration_ms = audio_duration_value_ms

                    print(
                        "[TTS][META][EXT] parsed external alignment:",
                        "words=",
                        len(words_forced),
                        "duration_ms=",
                        ext_duration_ms,
                    )

                    return {
                        "words": words_forced,
                        "duration_ms": int(ext_duration_ms),
                        "model_label": label,
                    }

            idx_candidate = idx_candidate + 1

        return None

    def _project_alignment_to_canonical(
            ext_words_value: List[Dict[str, Any]],
            text_clean_value: str,
            duration_ms_value: int,
            label_value: str,
    ) -> List[Dict[str, Any]]:
        """
        ###1. Tokenise canonical text by whitespace spans
        ###2. Treat external alignment words as timing segments only (ignore their token strings)
        ###3. Project segment timing onto canonical token spans by proportional index mapping
        ###4. Enforce monotone timestamps and clamp to duration_ms_value when provided
        """
        spans: List[Dict[str, int]] = []
        chars = list(text_clean_value)
        n_chars = len(chars)

        in_word = False
        w_start = 0
        pos = 0
        while pos < n_chars:
            c = chars[pos]
            if c.isspace():
                if in_word:
                    spans.append({"start": int(w_start), "end": int(pos)})
                    in_word = False
            else:
                if not in_word:
                    in_word = True
                    w_start = pos
            pos = pos + 1
        if in_word:
            spans.append({"start": int(w_start), "end": int(n_chars)})

        tokens_count = len(spans)
        if tokens_count == 0:
            return []

        if type(ext_words_value) is not list or len(ext_words_value) == 0:
            return []

        n_ext = len(ext_words_value)

        if duration_ms_value <= 0:
            last_end_ms = ext_words_value[-1].get("end_ms")
            if type(last_end_ms) is int or type(last_end_ms) is float:
                duration_ms_value = int(last_end_ms)
            else:
                duration_ms_value = 0

        if duration_ms_value < 0:
            duration_ms_value = 0

        def _ms_from_word_item(w_item: Dict[str, Any], key_ms: str, key_s: str) -> int:
            v_ms = w_item.get(key_ms)
            if type(v_ms) is int:
                return int(v_ms)
            if type(v_ms) is float:
                return int(v_ms)

            v_s = w_item.get(key_s)
            if type(v_s) is int or type(v_s) is float:
                return int(float(v_s) * 1000.0)

            return 0

        words_projected: List[Dict[str, Any]] = []
        prev_end_ms = 0

        k = 0
        while k < tokens_count:
            span = spans[k]
            s_idx = int(span["start"])
            e_idx = int(span["end"])

            if s_idx < 0:
                s_idx = 0
            if e_idx < s_idx:
                e_idx = s_idx
            if e_idx > len(text_clean_value):
                e_idx = len(text_clean_value)

            token_text = ""
            if s_idx < len(text_clean_value) and e_idx >= s_idx:
                token_text = text_clean_value[s_idx:e_idx]

            start_idx = int(k * n_ext / tokens_count)
            end_idx = int((k + 1) * n_ext / tokens_count) - 1
            if end_idx < start_idx:
                end_idx = start_idx
            if end_idx >= n_ext:
                end_idx = n_ext - 1

            seg_start_ms = _ms_from_word_item(ext_words_value[start_idx], "start_ms", "start")
            seg_end_ms = _ms_from_word_item(ext_words_value[end_idx], "end_ms", "end")

            start_ms = int(seg_start_ms)
            end_ms = int(seg_end_ms)

            if start_ms < prev_end_ms:
                start_ms = prev_end_ms
            if start_ms < 0:
                start_ms = 0

            if end_ms < start_ms:
                end_ms = start_ms + 40

            if duration_ms_value > 0 and end_ms > duration_ms_value:
                end_ms = int(duration_ms_value)

            words_projected.append(
                {
                    "index": int(k),
                    "word": token_text,
                    "start_ms": int(start_ms),
                    "end_ms": int(end_ms),
                }
            )

            prev_end_ms = int(end_ms)
            k = k + 1

        if duration_ms_value > 0 and len(words_projected) > 0:
            last_end = words_projected[-1].get("end_ms")
            if type(last_end) is int and last_end < duration_ms_value:
                print(
                    "[TTS][META][PROJECT] bumping last token end_ms from",
                    last_end,
                    "to duration_ms",
                    duration_ms_value,
                    "label=",
                    label_value,
                )
                words_projected[-1]["end_ms"] = int(duration_ms_value)

        print(
            "[TTS][META][PROJECT] projected external alignment onto canonical tokens:",
            "label=",
            label_value,
            "ext_segments=",
            n_ext,
            "canonical_tokens=",
            tokens_count,
        )

        return words_projected

    external_alignment = _load_external_alignment(audio_path, audio_duration_ms)

    if existing_ok and isinstance(meta_existing, dict):
        if external_alignment is not None:
            ext_words_raw = external_alignment["words"]
            ext_duration_ms = external_alignment["duration_ms"]
            model_label = external_alignment["model_label"]

            ext_words = ext_words_raw
            if type(model_label) is str and model_label.strip() != "" and model_label != "whisper-1":
                ext_words = _project_alignment_to_canonical(
                    ext_words_raw,
                    text_clean,
                    ext_duration_ms if ext_duration_ms > 0 else audio_duration_ms,
                    str(model_label),
                )

            else:
                ext_words = ext_words_raw

            if ext_duration_ms <= 0:
                if audio_duration_ms > 0:
                    ext_duration_ms = audio_duration_ms
                elif ext_words:
                    last_end_val = ext_words[-1].get("end_ms", 0)
                    if isinstance(last_end_val, int) and last_end_val > 0:
                        ext_duration_ms = last_end_val

            meta_existing["tts_text"] = original_text
            meta_existing["words"] = ext_words
            meta_existing["duration_ms"] = ext_duration_ms

            reading_time_s_ext = 0.0
            if ext_duration_ms > 0:
                reading_time_s_ext = float(ext_duration_ms) / 1000.0
            meta_existing["reading_time_s"] = reading_time_s_ext

            wpm_ext = 0.0
            if reading_time_s_ext > 0.0 and len(ext_words) > 0:
                wpm_ext = 60.0 * float(len(ext_words)) / reading_time_s_ext
            meta_existing["words_per_minute"] = wpm_ext
            meta_existing["transcription_model"] = model_label

            duration_ms = ext_duration_ms
            duration_s = float(ext_duration_ms) / 1000.0 if ext_duration_ms > 0 else 0.0

        if isinstance(placeholder_meta, dict):
            meta_existing["placeholder_meta"] = placeholder_meta

        with meta_path.open("w", encoding="utf-8") as f_meta_existing:
            json.dump(meta_existing, f_meta_existing, ensure_ascii=False, indent=2)

        print(
            "[TTS][META] refreshed sidecar (existing_ok=True, external_align=",
            "yes" if external_alignment is not None else "no",
            "):",
            str(meta_path),
        )

        _append_html_metadata(audio_path, meta_path)
        return

    if external_alignment is not None:
        ext_words_raw = external_alignment["words"]
        ext_duration_ms = external_alignment["duration_ms"]
        model_label = external_alignment["model_label"]

        ext_words = ext_words_raw
        if type(model_label) is str and model_label.strip() != "" and model_label != "whisper-1":
            ext_words = _project_alignment_to_canonical(
                ext_words_raw,
                text_clean,
                ext_duration_ms if ext_duration_ms > 0 else audio_duration_ms,
                str(model_label),
            )

        else:
            ext_words = ext_words_raw

        duration_ms = ext_duration_ms
        if duration_ms <= 0:
            if audio_duration_ms > 0:
                duration_ms = audio_duration_ms
            elif ext_words:
                last_end_val = ext_words[-1].get("end_ms", 0)
                if isinstance(last_end_val, int) and last_end_val > 0:
                    duration_ms = last_end_val

        if duration_ms < 0:
            duration_ms = 0

        duration_s = float(duration_ms) / 1000.0 if duration_ms > 0 else 0.0

        reading_time_s = duration_s
        total_words = len(ext_words)
        wpm = 0.0
        if reading_time_s > 0.0 and total_words > 0:
            wpm = 60.0 * float(total_words) / reading_time_s

        meta_ext = {
            "section_id": section_id,
            "voice": voice,
            "voice_instructions": voice_instructions,
            "tts_model": model,
            "transcription_model": model_label,
            "text_hash": text_hash,
            "tts_text": original_text,
            "canonical_text": original_text,
            "text_len": len(original_text),
            "duration_ms": duration_ms,
            "reading_time_s": reading_time_s,
            "words_per_minute": wpm,
            "lead_in_ms": 0,
            "tail_out_ms": 0,
            "words": ext_words,
            "alignment_version": 4,
        }

        if isinstance(placeholder_meta, dict):
            meta_ext["placeholder_meta"] = placeholder_meta

        with meta_path.open("w", encoding="utf-8") as f_meta_ext:
            json.dump(meta_ext, f_meta_ext, ensure_ascii=False, indent=2)

        print(
            "[TTS][META] written external alignment metadata:",
            str(meta_path),
            "duration_ms=",
            duration_ms,
            "words=",
            total_words,
            "alignment_version=",
            4,
        )

        _append_html_metadata(audio_path, meta_path)
        return

    if audio_duration_ms > 0 and duration_ms <= 0:
        duration_ms = audio_duration_ms
        duration_s = float(duration_ms) / 1000.0

    words_out: List[Dict[str, Any]] = []
    lead_in_ms = 0
    tail_out_ms = 0

    def _canonical_word_spans(text_value: str) -> List[Dict[str, int]]:
        spans: List[Dict[str, int]] = []
        chars = list(text_value)
        n_chars = len(chars)
        in_word = False
        w_start = 0
        pos = 0
        while pos < n_chars:
            c = chars[pos]
            if c.isspace():
                if in_word:
                    spans.append({"start": w_start, "end": pos})
                    in_word = False
            else:
                if not in_word:
                    in_word = True
                    w_start = pos
            pos = pos + 1
        if in_word:
            spans.append({"start": w_start, "end": n_chars})
        return spans

    def _forced_align_words(audio_path_value: Path, text_clean_value: str, canonical_spans_value,
                            duration_ms_value: int):
        import os
        import wave as _wave_mod
        import array
        from pathlib import Path as _PathAlias
        from typing import Any as _Any, Dict as _Dict, List as _List
        from openai import OpenAI as _OpenAI

        def _build_alignment_wav(src_path: _PathAlias, max_bytes: int) -> _PathAlias | None:
            if not src_path.exists():
                print("[TTS][ALIGN] source WAV for alignment does not exist:", str(src_path))
                return None

            wf_loc = _wave_mod.open(str(src_path), "rb")
            channels_loc = wf_loc.getnchannels()
            sampwidth_loc = wf_loc.getsampwidth()
            rate_loc = wf_loc.getframerate()
            frames_loc = wf_loc.getnframes()
            frames_bytes_loc = wf_loc.readframes(frames_loc)
            wf_loc.close()

            print(
                "[TTS][ALIGN] source params:",
                "channels=",
                channels_loc,
                "sampwidth=",
                sampwidth_loc,
                "rate=",
                rate_loc,
                "frames=",
                frames_loc,
            )

            if sampwidth_loc != 2:
                print("[TTS][ALIGN] non-16bit PCM, skipping alignment downsample.")
                return None

            samples = array.array("h")
            samples.frombytes(frames_bytes_loc)
            n_samples_loc = len(samples)

            if channels_loc == 2:
                mono_samples = array.array("h")
                i_loc = 0
                while i_loc < n_samples_loc:
                    left = int(samples[i_loc])
                    right = int(samples[i_loc + 1])
                    avg_val = int((left + right) / 2)
                    mono_samples.append(avg_val)
                    i_loc = i_loc + 2
            else:
                mono_samples = samples

            rate_out = rate_loc
            target_rate = 16000

            if rate_loc > target_rate:
                n_src = len(mono_samples)
                if n_src > 0:
                    n_tgt = int(n_src * target_rate / rate_loc)
                    if n_tgt < 1:
                        n_tgt = 1
                    resampled = array.array("h")
                    i_loc = 0
                    while i_loc < n_tgt:
                        src_index = int(i_loc * rate_loc / target_rate)
                        if src_index >= n_src:
                            src_index = n_src - 1
                        resampled.append(mono_samples[src_index])
                        i_loc = i_loc + 1
                    mono_samples = resampled
                    rate_out = target_rate

            out_path = src_path.with_suffix(".align_mono16k.wav")

            wf_out = _wave_mod.open(str(out_path), "wb")
            wf_out.setnchannels(1)
            wf_out.setsampwidth(2)
            wf_out.setframerate(rate_out)
            wf_out.writeframes(mono_samples.tobytes())
            wf_out.close()

            size_new = out_path.stat().st_size
            print(
                "[TTS][ALIGN] alignment WAV:",
                str(out_path),
                "size_bytes=",
                size_new,
            )

            if size_new > max_bytes:
                print(
                    "[TTS][ALIGN] alignment WAV still over limit (",
                    size_new,
                    ">",
                    max_bytes,
                    "), skipping forced alignment.",
                )
                return None

            return out_path

        p_val = _PathAlias(audio_path_value)
        if not p_val.exists():
            print("[TTS][ALIGN] audio path does not exist:", str(p_val))
            return []

        stat_info_val = p_val.stat()
        file_size_bytes_val = stat_info_val.st_size
        max_bytes = 24 * 1024 * 1024

        print(
            "[TTS][ALIGN] original file size bytes=",
            file_size_bytes_val,
            "max_bytes=",
            max_bytes,
        )

        align_path = p_val
        if file_size_bytes_val > max_bytes:
            print("[TTS][ALIGN] building reduced alignment WAV (mono 16 kHz)")
            reduced = _build_alignment_wav(p_val, max_bytes)
            if reduced is None:
                print("[TTS][ALIGN] reduced alignment WAV unavailable, skipping forced alignment.")
                return []
            align_path = reduced

        client_loc = _OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        audio_file = open(str(align_path), "rb")

        transcr = client_loc.audio.transcriptions.create(
            model="whisper-1",
            file=audio_file,
            response_format="verbose_json",
            temperature=0,
            prompt=text_clean_value,
            timestamp_granularities=["word"],
        )

        words_meta = transcr.words
        if not isinstance(words_meta, list) or not words_meta:
            print("[TTS][ALIGN] transcription returned no words, skipping forced alignment.")
            return []

        print(
            "[TTS][ALIGN] transcription words_len=",
            len(words_meta),
            "canonical_spans_len=",
            len(canonical_spans_value),
        )

        def _ms_bounds(word_item: _Any, fallback_duration_ms: int) -> tuple[int, int]:
            start_val = None
            end_val = None

            if isinstance(word_item, dict):
                start_val = word_item.get("start_ms")
                end_val = word_item.get("end_ms")
                if not isinstance(start_val, (int, float)):
                    start_alt = word_item.get("start")
                    if isinstance(start_alt, (int, float)):
                        start_val = start_alt * 1000.0
                if not isinstance(end_val, (int, float)):
                    end_alt = word_item.get("end")
                    if isinstance(end_alt, (int, float)):
                        end_val = end_alt * 1000.0
            else:
                start_val = getattr(word_item, "start_ms", None)
                end_val = getattr(word_item, "end_ms", None)
                if not isinstance(start_val, (int, float)):
                    start_alt = getattr(word_item, "start", None)
                    if isinstance(start_alt, (int, float)):
                        start_val = start_alt * 1000.0
                if not isinstance(end_val, (int, float)):
                    end_alt = getattr(word_item, "end", None)
                    if isinstance(end_alt, (int, float)):
                        end_val = end_alt * 1000.0

            if not isinstance(start_val, (int, float)):
                start_val = 0.0
            if not isinstance(end_val, (int, float)):
                end_val = start_val

            s_ms_val = int(start_val)
            e_ms_val = int(end_val)

            if s_ms_val < 0:
                s_ms_val = 0
            if e_ms_val < s_ms_val:
                e_ms_val = s_ms_val + 40
            if fallback_duration_ms > 0 and e_ms_val > fallback_duration_ms:
                e_ms_val = fallback_duration_ms

            return s_ms_val, e_ms_val

        n_canon = len(canonical_spans_value)
        n_meta = len(words_meta)
        limit = n_canon
        if n_meta < limit:
            limit = n_meta

        if limit <= 0:
            print("[TTS][ALIGN] no overlapping words between canonical and ASR, skipping.")
            return []

        if duration_ms_value <= 0:
            duration_ms_value = 0

        words_forced_loc: _List[_Dict[str, _Any]] = []

        i_loc = 0
        while i_loc < limit:
            span = canonical_spans_value[i_loc]
            meta_word = words_meta[i_loc]

            s_idx = span.get("start", 0)
            e_idx = span.get("end", 0)
            if s_idx < 0:
                s_idx = 0
            if e_idx < s_idx:
                e_idx = s_idx

            if s_idx >= len(text_clean_value):
                text_slice = ""
            else:
                if e_idx > len(text_clean_value):
                    e_idx = len(text_clean_value)
                text_slice = text_clean_value[s_idx:e_idx]

            w_start_ms, w_end_ms = _ms_bounds(meta_word, duration_ms_value)

            words_forced_loc.append(
                {
                    "index": i_loc,
                    "word": text_slice,
                    "start_ms": int(w_start_ms),
                    "end_ms": int(w_end_ms),
                }
            )

            i_loc = i_loc + 1

        print(
            "[TTS][ALIGN] forced alignment words built:",
            len(words_forced_loc),
            "items",
        )

        return words_forced_loc

    if duration_ms > 0 and text_clean != "":
        spans = _canonical_word_spans(text_clean)
        print("[TTS][META] canonical word spans:", len(spans))

        words_forced = _forced_align_words(audio_path, text_clean, spans, duration_ms)

        if words_forced:
            print("[TTS][META] using forced-alignment timings from Whisper")
            words_out = words_forced
        else:
            print("[TTS][META] forced alignment unavailable, falling back to proportional timings")
            n_chars = len(text_clean)
            if n_chars <= 0:
                words_out = []
            else:
                total_chars = 0
                idx_span = 0
                while idx_span < len(spans):
                    span = spans[idx_span]
                    s_idx = span["start"]
                    e_idx = span["end"]
                    if s_idx < 0:
                        s_idx = 0
                    if e_idx > n_chars:
                        e_idx = n_chars
                    if e_idx > s_idx:
                        total_chars = total_chars + (e_idx - s_idx)
                    idx_span = idx_span + 1

                if total_chars <= 0:
                    total_chars = 1

                cumulative = 0
                idx_span = 0
                while idx_span < len(spans):
                    span = spans[idx_span]
                    s_idx = span["start"]
                    e_idx = span["end"]
                    if s_idx < 0:
                        s_idx = 0
                    if e_idx > n_chars:
                        e_idx = n_chars
                    if e_idx <= s_idx:
                        word_text = ""
                        start_ms = cumulative
                        end_ms = cumulative
                    else:
                        length = e_idx - s_idx
                        word_text = text_clean[s_idx:e_idx]
                        start_ms = int(duration_ms * cumulative / total_chars)
                        cumulative = cumulative + length
                        end_ms = int(duration_ms * cumulative / total_chars)
                    if end_ms < start_ms:
                        end_ms = start_ms + 40
                    if duration_ms > 0 and end_ms > duration_ms:
                        end_ms = duration_ms
                    words_out.append(
                        {
                            "index": idx_span,
                            "word": word_text,
                            "start_ms": int(start_ms),
                            "end_ms": int(end_ms),
                        }
                    )
                    idx_span = idx_span + 1
    else:
        words_out = []

    if duration_ms <= 0 and words_out:
        last_ms = words_out[-1]["end_ms"]
        if isinstance(last_ms, int) and last_ms > 0:
            duration_ms = last_ms
            duration_s = float(duration_ms) / 1000.0

    if audio_duration_ms > 0 and duration_ms > 0:
        print(
            "[TTS][META][CHECK] duration_ms(before_align)=",
            duration_ms,
            "audio_duration_ms=",
            audio_duration_ms,
            "ratio=",
            float(audio_duration_ms) / float(duration_ms),
        )
        duration_ms = audio_duration_ms
        duration_s = float(duration_ms) / 1000.0

    if words_out and duration_ms > 0:
        last_end = words_out[-1]["end_ms"]
        if isinstance(last_end, int) and last_end < duration_ms:
            print(
                "[TTS][META][ALIGN] bumping last word end_ms from",
                last_end,
                "to duration_ms",
                duration_ms,
            )
            words_out[-1]["end_ms"] = duration_ms

    reading_time_s = 0.0
    if duration_ms > 0:
        reading_time_s = float(duration_ms) / 1000.0
    total_words = len(words_out)
    wpm = 0.0
    if reading_time_s > 0.0 and total_words > 0:
        wpm = 60.0 * float(total_words) / reading_time_s

    non_ws_chars_total = 0
    non_ws_chars_no_placeholders = 0

    if isinstance(text_clean, str) and text_clean.strip() != "":
        buf_all: List[str] = []
        idx_ch = 0
        while idx_ch < len(text_clean):
            ch = text_clean[idx_ch]
            if not ch.isspace():
                buf_all.append(ch)
            idx_ch = idx_ch + 1
        non_ws_chars_total = len(buf_all)

        text_no_ph = re.sub(r"\[[A-Za-z0-9_]+\]", " ", text_clean)
        buf_noph: List[str] = []
        idx_ch = 0
        while idx_ch < len(text_no_ph):
            ch = text_no_ph[idx_ch]
            if not ch.isspace():
                buf_noph.append(ch)
            idx_ch = idx_ch + 1
        non_ws_chars_no_placeholders = len(buf_noph)

    placeholder_chars = 0
    if non_ws_chars_total > 0 and non_ws_chars_no_placeholders >= 0:
        placeholder_chars = non_ws_chars_total - non_ws_chars_no_placeholders
        if placeholder_chars < 0:
            placeholder_chars = 0

    est_duration_no_placeholders_ms = duration_ms
    if duration_ms > 0 and non_ws_chars_total > 0:
        est_duration_no_placeholders_ms = int(
            duration_ms
            * float(non_ws_chars_no_placeholders)
            / float(non_ws_chars_total)
        )

    print(
        "[TTS][META][TEXT-COVERAGE]",
        "duration_ms=",
        duration_ms,
        "non_ws_chars_total=",
        non_ws_chars_total,
        "non_ws_chars_no_placeholders=",
        non_ws_chars_no_placeholders,
        "placeholder_chars=",
        placeholder_chars,
        "est_duration_no_placeholders_ms=",
        est_duration_no_placeholders_ms,
    )
    def _canonical_word_spans_for_projection(text_value: str) -> List[Dict[str, int]]:
        spans: List[Dict[str, int]] = []
        chars = list(text_value)
        n_chars = len(chars)
        in_word = False
        w_start = 0
        pos = 0
        while pos < n_chars:
            c = chars[pos]
            if c.isspace():
                if in_word:
                    spans.append({"start": w_start, "end": pos})
                    in_word = False
            else:
                if not in_word:
                    in_word = True
                    w_start = pos
            pos = pos + 1
        if in_word:
            spans.append({"start": w_start, "end": n_chars})
        return spans

    def _find_token_index_for_char(spans_value: List[Dict[str, int]], char_pos: int) -> int:
        i_loc = 0
        while i_loc < len(spans_value):
            s_loc = spans_value[i_loc].get("start", 0)
            e_loc = spans_value[i_loc].get("end", 0)
            if char_pos < s_loc:
                return i_loc
            if char_pos >= s_loc and char_pos < e_loc:
                return i_loc
            i_loc = i_loc + 1
        if len(spans_value) == 0:
            return 0
        return len(spans_value) - 1

    def _timing_from_char_span(
        spans_value: List[Dict[str, int]],
        words_value: List[Dict[str, Any]],
        char_start: int,
        char_end: int,
    ) -> tuple[int, int, int, int]:
        if char_start < 0:
            char_start = 0
        if char_end < char_start:
            char_end = char_start

        i_start = _find_token_index_for_char(spans_value, char_start)
        i_end = _find_token_index_for_char(spans_value, char_end)

        if i_end < i_start:
            i_end = i_start

        if i_start < 0:
            i_start = 0
        if i_end < 0:
            i_end = 0
        if i_start >= len(words_value):
            i_start = len(words_value) - 1
        if i_end >= len(words_value):
            i_end = len(words_value) - 1

        w_s = words_value[i_start]
        w_e = words_value[i_end]

        s_ms = w_s.get("start_ms")
        e_ms = w_e.get("end_ms")

        if type(s_ms) is not int and type(s_ms) is not float:
            s_ms = 0
        if type(e_ms) is not int and type(e_ms) is not float:
            e_ms = s_ms

        s_int = int(s_ms)
        e_int = int(e_ms)

        if s_int < 0:
            s_int = 0
        if e_int < s_int:
            e_int = s_int + 40
        if e_int == s_int:
            e_int = s_int + 160

        idx_start = w_s.get("index")
        idx_end = w_e.get("index")
        if type(idx_start) is not int:
            idx_start = i_start
        if type(idx_end) is not int:
            idx_end = i_end

        return s_int, e_int, int(idx_start), int(idx_end)

    placeholders_timing: List[Dict[str, Any]] = []

    spans_for_projection = _canonical_word_spans_for_projection(text_clean)

    anchors_list = None
    blocks_list = None
    if type(placeholder_meta) is dict:
        anchors_list = placeholder_meta.get("anchors")
        blocks_list = placeholder_meta.get("blocks")

    used_char_spans = False

    if type(anchors_list) is list and len(anchors_list) > 0 and len(words_out) > 0 and len(spans_for_projection) > 0:
        i_a = 0
        while i_a < len(anchors_list):
            a = anchors_list[i_a]
            if type(a) is dict:
                ph = a.get("placeholder") or a.get("id") or ""
                cs = a.get("tts_char_start")
                ce = a.get("tts_char_end")

                if type(ph) is str and ph.strip() != "" and type(cs) is int and type(ce) is int:
                    s_int, e_int, idx_s, idx_e = _timing_from_char_span(spans_for_projection, words_out, cs, ce)
                    placeholders_timing.append(
                        {
                            "kind": "anchor",
                            "placeholder": ph.strip(),
                            "start_ms": s_int,
                            "end_ms": e_int,
                            "index_start": idx_s,
                            "index_end": idx_e,
                            "block_id": a.get("block_id") or "",
                        }
                    )
                    used_char_spans = True
            i_a = i_a + 1

    if type(blocks_list) is list and len(blocks_list) > 0 and len(words_out) > 0 and len(spans_for_projection) > 0:
        i_b = 0
        while i_b < len(blocks_list):
            b = blocks_list[i_b]
            if type(b) is dict:
                ph = b.get("placeholder") or b.get("id") or ""
                cs = b.get("tts_char_start")
                ce = b.get("tts_char_end")

                if type(ph) is str and ph.strip() != "" and type(cs) is int and type(ce) is int:
                    s_int, e_int, idx_s, idx_e = _timing_from_char_span(spans_for_projection, words_out, cs, ce)
                    placeholders_timing.append(
                        {
                            "kind": "block",
                            "placeholder": ph.strip(),
                            "start_ms": s_int,
                            "end_ms": e_int,
                            "index_start": idx_s,
                            "index_end": idx_e,
                            "block_type": b.get("type") or "",
                            "level": b.get("level") if type(b.get("level")) is int else 0,
                        }
                    )
                    used_char_spans = True
            i_b = i_b + 1

    if not used_char_spans:
        idx_ph = 0
        while idx_ph < total_words:
            w_item = words_out[idx_ph]
            idx_ph = idx_ph + 1
            if type(w_item) is not dict:
                continue
            token = w_item.get("word")
            if type(token) is not str:
                continue
            token_stripped = token.strip()
            if not token_stripped.startswith("[") or not token_stripped.endswith("]"):
                continue

            s_val = w_item.get("start_ms")
            e_val = w_item.get("end_ms")
            if type(s_val) is not int and type(s_val) is not float:
                s_val = 0
            if type(e_val) is not int and type(e_val) is not float:
                e_val = s_val

            s_int = int(s_val)
            e_int = int(e_val)

            if s_int < 0:
                s_int = 0
            if e_int < s_int:
                e_int = s_int
            if e_int == s_int:
                e_int = s_int + 160

            placeholders_timing.append(
                {
                    "kind": "marker",
                    "index": w_item.get("index"),
                    "placeholder": token_stripped,
                    "start_ms": s_int,
                    "end_ms": e_int,
                }
            )

    meta = {
        "section_id": section_id,
        "voice": voice,
        "voice_instructions": voice_instructions,
        "tts_model": model,
        "transcription_model": "whisper-1",
        "text_hash": text_hash,
        "tts_text": original_text,
        "canonical_text": original_text,
        "text_len": len(original_text),
        "duration_ms": duration_ms,
        "reading_time_s": reading_time_s,
        "words_per_minute": wpm,
        "lead_in_ms": int(lead_in_ms),
        "tail_out_ms": int(tail_out_ms),
        "words": words_out,
        "alignment_version": 4,
        "placeholders_timing": placeholders_timing,
    }

    if isinstance(placeholder_meta, dict):
        meta["placeholder_meta"] = placeholder_meta

    with meta_path.open("w", encoding="utf-8") as f_out:
        json.dump(meta, f_out, ensure_ascii=False, indent=2)

    print(
        "[TTS][META] written:",
        str(meta_path),
        "duration_ms=",
        duration_ms,
        "words=",
        total_words,
        "alignment_version=",
        4,
    )

    _append_html_metadata(audio_path, meta_path)


def generate_tts_for_section(
    text: str,
    *,
    section_id: str = "",
    model: str = "gpt-4o-mini-tts",
    voice: str = "alloy",
    voice_instructions: Optional[str] = None,
    out_dir: Optional[Path] = None,
    file_extension: str = "mp3",
    placeholder_meta: Optional[dict] = None,
    zotero_collection="no_collection",

    aligner: str = "ctc",
    progress_cb=None,
) -> Path:
    """
    ###1. Canonicalise input text and build stable filename (section_id + text hash + voice config)
    ###2. Generate audio once per canonical text (+voice_instructions) and cache on disk
    ###3. Run alignment backend (ctc or mfa) and build metadata
    ###4. Persist sidecar JSON metadata: one text → one token list → one alignment file
    ###5. Keep UI and metadata in sync by always using the canonical text tokens
    """
    if not isinstance(text, str):
        raise TypeError("text must be a string.")
    raw_trimmed = text.strip()
    if raw_trimmed == "":
        raise ValueError("text must not be empty.")

    import os
    import hashlib
    import sys

    from pathlib import Path as _PathAlias
    from openai import OpenAI

    def _notify(progress: int, message: str) -> None:
        if progress < 0:
            progress = 0
        if progress > 100:
            progress = 100
        if progress_cb is None:
            print("[TTS][PROGRESS]", str(progress) + "%", message)
            return
        progress_cb(progress, message)
    def _canonicalise_text(value: str) -> str:
        """
        ###1. Normalise line breaks and whitespace
        ###2. Strip leading/trailing spaces and collapse internal runs
        """
        replaced = value.replace("\u2029", " ").replace("\u2028", " ")
        lines = replaced.splitlines()
        parts = []
        i_line = 0
        while i_line < len(lines):
            segment = lines[i_line].strip()
            if segment != "":
                parts.append(segment)
            i_line = i_line + 1
        joined = " ".join(parts)
        tokens = joined.split()
        return " ".join(tokens).strip()

    def _ensure_tts_text_in_meta(meta_path_local: Path, tts_text_value: str) -> None:
        """
        ###1. Load <wav>.json
        ###2. Write meta['tts_text']=tts_text_value if missing or different
        ###3. Persist immediately (so _append_html_metadata can rely on it)
        """
        import json

        raw = meta_path_local.read_text(encoding="utf-8")
        meta_obj = json.loads(raw)

        existing = meta_obj.get("tts_text")
        if type(existing) is str and existing == tts_text_value:
            return

        meta_obj["tts_text"] = tts_text_value
        meta_path_local.write_text(json.dumps(meta_obj, ensure_ascii=False, indent=2), encoding="utf-8")

    def _ensure_tts_markers_in_meta(meta_path_local: Path, placeholder_meta_local: object) -> None:
        """
        ###1. Load <wav>.json
        ###2. If placeholder_meta_local has marker fields, persist:
            - meta['tts_text_marked']
            - meta['marker_prefix']
            - meta['marker_suffix']
            - meta['placeholder_meta'] (blocks/anchors/num_blocks)
        ###3. Persist immediately (so _build_html_from_tts_meta can rely on it)
        """
        import json

        if type(placeholder_meta_local) is not dict:
            return

        tts_text_marked = placeholder_meta_local.get("tts_text_marked")
        marker_prefix = placeholder_meta_local.get("marker_prefix")
        marker_suffix = placeholder_meta_local.get("marker_suffix")

        if type(tts_text_marked) is not str or tts_text_marked.strip() == "":
            return
        if type(marker_prefix) is not str or marker_prefix == "":
            return
        if type(marker_suffix) is not str or marker_suffix == "":
            return

        blocks = placeholder_meta_local.get("blocks")
        anchors = placeholder_meta_local.get("anchors")
        num_blocks = placeholder_meta_local.get("num_blocks")

        if type(blocks) is not list:
            return
        if type(anchors) is not list:
            return
        if type(num_blocks) is not int:
            num_blocks = len(blocks)

        raw = meta_path_local.read_text(encoding="utf-8")
        meta_obj = json.loads(raw)

        meta_obj["tts_text_marked"] = tts_text_marked
        meta_obj["marker_prefix"] = marker_prefix
        meta_obj["marker_suffix"] = marker_suffix

        meta_obj["placeholder_meta"] = {
            "blocks": blocks,
            "anchors": anchors,
            "num_blocks": int(num_blocks),
        }

        meta_path_local.write_text(json.dumps(meta_obj, ensure_ascii=False, indent=2), encoding="utf-8")

    canonical_text = _canonicalise_text(raw_trimmed)
    if canonical_text == "":
        raise ValueError("canonical text must not be empty after normalisation.")

    if voice_instructions is None:
        voice_instructions = (
            "Voice: academic British English, clear and confident.\n"
            "Tone: engaging and lecture-like, expressive without exaggeration.\n"
            "Energy: moderate-high; convey intellectual curiosity and interest.\n"
            "Pacing: deliberate and measured; brief pauses after commas, longer pauses at sentence endings.\n"
            "Pronunciation: precise and articulated RP-leaning British English.\n"
            "Stress pattern: highlight keywords, theoretical terms, and contrasts.\n"
            "Delivery style: passionate scholar explaining ideas to an attentive audience.\n"
            "Rhythm: speech should rise gently into important points, fall into reflection.\n"
            "Flow: no monotone; subtle variation in pitch to signal emphasis and structure.\n"
            "Cadence: maintain even tempo but allow micro-pauses before key transitions.\n"
            "Breathing: natural; slight intake before long sentences.\n"
        )


    base_root_raw = out_dir if out_dir is not None else (MAIN_APP_CACHE_DIR / "tts")

    coll = zotero_collection.strip() if isinstance(zotero_collection, str) else ""
    if coll:
        base_root_raw = Path(base_root_raw) / coll

    base_root = Path(base_root_raw)
    base_root.mkdir(parents=True, exist_ok=True)

    def _make_section_subdir(base_root_path: Path, section_id_value: str) -> Path:
        """
        ###1. Sanitise section_id into a filesystem-safe folder name
        ###2. Create and return section-specific subdirectory under base_root_path
        """
        raw = section_id_value.strip() if isinstance(section_id_value, str) else ""
        if raw == "":
            safe = "section_default"
        else:
            safe_chars = []
            idx = 0
            while idx < len(raw):
                ch = raw[idx]
                idx = idx + 1
                if ch.isalnum():
                    safe_chars.append(ch)
                elif ch in ("-", "_"):
                    safe_chars.append(ch)
                else:
                    safe_chars.append("_")
            safe = "".join(safe_chars)
            if safe == "":
                safe = "section_default"

        subdir = base_root_path / safe
        subdir.mkdir(parents=True, exist_ok=True)
        print(
            "[TTS][PATH]",
            "zotero_collection=",
            repr(coll),
            "section_id=",
            repr(section_id_value),
            "→ folder=",
            str(subdir),
        )

        return subdir

    base_folder = _make_section_subdir(base_root, section_id)

    voice_id = (voice or "").strip() or "alloy"
    model_id = (model or "").strip() or "gpt-4o-mini-tts"

    cache_parts: list[str] = [canonical_text]
    if isinstance(voice_instructions, str):
        vi_stripped = voice_instructions.strip()
        if vi_stripped != "":
            cache_parts.append("[VI]")
            cache_parts.append(vi_stripped)
    cache_parts.append("[VOICE]")
    cache_parts.append(voice_id)
    cache_parts.append("[MODEL]")
    cache_parts.append(model_id)

    hash_input = "\n".join(cache_parts)
    text_hash = hashlib.sha1(hash_input.encode("utf-8")).hexdigest()[:10]

    # print("text hash>",text_hash)
    # input("aaaaa")
    ext = file_extension.lstrip(".") or "mp3"
    ext = ext.lower()

    stem = f"tts_{text_hash}"
    output_path = base_folder / f"{stem}_{voice_id}_{model_id}.{ext}"
    meta_path = output_path.with_suffix(output_path.suffix + ".json")
    mfa_text_path = output_path.with_suffix(".mfa.txt")
    mfa_textgrid_path = output_path.with_suffix(".TextGrid")
    mfa_json_path = output_path.with_suffix(".mfa.json")
    wav_exists = output_path.is_file()

    print("[TTS] generate_tts_for_section called")
    print("[TTS] section_id:", repr(section_id))
    print("[TTS] model:", repr(model_id))
    print("[TTS] voice:", repr(voice_id))
    if isinstance(voice_instructions, str) and voice_instructions.strip() != "":
        print("[TTS] voice_instructions: provided, len:", len(voice_instructions.strip()))
    else:
        print("[TTS] voice_instructions: None")
    print("[TTS] requested extension:", repr(ext))
    print("[TTS] canonical_text_preview:", repr(canonical_text[:80]))
    print("[TTS] base_folder:", str(base_folder))
    print("[TTS] output_path:", str(output_path))
    print("[TTS] meta_path:", str(meta_path))
    print("[TTS][MFA] wav_exists:", wav_exists)
    print("[TTS][MFA] text_path_for_aligner:", str(mfa_text_path))
    print("[TTS][MFA] expected_alignment_json_path:", str(mfa_json_path))
    print("[TTS] text_hash:", text_hash)
    print("[TTS] aligner:", repr(aligner))

    _notify(5, "starting TTS generation")

    audio_ok = output_path.exists() and output_path.stat().st_size > 0
    meta_ok = meta_path.exists() and meta_path.stat().st_size > 0

    if audio_ok and meta_ok:
        print("[TTS] cache hit: audio and metadata already exist:", str(output_path))

        import json
        meta_obj = json.loads(meta_path.read_text(encoding="utf-8"))

        html_val = meta_obj.get("tts_html")
        html_body_val = meta_obj.get("tts_html_body")

        if (type(html_val) is not str or html_val.strip() == "") or (
                type(html_body_val) is not str or html_body_val.strip() == ""):
            print("[TTS] cache hit but tts_html missing/empty → appending HTML metadata:", str(meta_path))
            _ensure_tts_text_in_meta(meta_path, canonical_text)
            _ensure_tts_markers_in_meta(meta_path, placeholder_meta)
            _append_html_metadata(output_path, meta_path)

        _notify(100, "cache hit (audio and metadata already exist)")
        return output_path

    if audio_ok and not meta_ok:
        print("[TTS] audio exists but metadata missing → rebuilding metadata only:", str(output_path))
        _notify(35, "audio already cached; rebuilding metadata")
        _notify(60, "generating transcripts and alignment")

        _run_alignment_and_metadata(
            output_path,
            canonical_text,
            meta_path=meta_path,
            placeholder_meta=placeholder_meta,
            section_id=section_id,
            voice=voice_id,
            voice_instructions=voice_instructions,
            model=model_id,
            aligner=aligner,
        )
        _notify(90, "aligning audio and text")
        _ensure_tts_text_in_meta(meta_path, canonical_text)
        _ensure_tts_markers_in_meta(meta_path, placeholder_meta)
        _append_html_metadata(output_path, meta_path)

        return output_path

    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    if sys.platform.startswith("win") and ext == "wav":
        """
        ###1. If canonical text is too long for the TTS model, split into parts on block markers
        ###2. Generate part WAVs, enforce stereo, then concatenate into one WAV
        ###3. Align each part, then merge metadata by shifting indices/timestamps
        """
        import wave
        import array
        import json

        def _ensure_stereo_wav(path: Path) -> None:
            """
            ###1. Read WAV header and frames
            ###2. If mono 16-bit, duplicate channel → stereo with same rate
            """
            if not path.exists():
                print("[TTS][WAV-STEREO] path does not exist:", str(path))
                return

            wf = wave.open(str(path), "rb")
            ch = wf.getnchannels()
            sw = wf.getsampwidth()
            sr = wf.getframerate()
            fr = wf.getnframes()
            frames_bytes = wf.readframes(fr)
            wf.close()

            if ch == 2:
                return
            if ch != 1 or sw != 2:
                return

            samples_mono = array.array("h")
            samples_mono.frombytes(frames_bytes)
            n_samples = len(samples_mono)

            samples_stereo = array.array("h")
            i_sample = 0
            while i_sample < n_samples:
                s = samples_mono[i_sample]
                samples_stereo.append(s)
                samples_stereo.append(s)
                i_sample = i_sample + 1

            wf_out = wave.open(str(path), "wb")
            wf_out.setnchannels(2)
            wf_out.setsampwidth(2)
            wf_out.setframerate(sr)
            wf_out.writeframes(samples_stereo.tobytes())
            wf_out.close()

        def _approx_token_count(s: str) -> int:
            """
            ###1. Approximate token count without tiktoken
            """
            words = s.split()
            n = len(words)
            return int(n * 1.35) + 5

        def _split_on_block_markers(text_value: str, max_words: int) -> list[str]:
            """
            ###1. Split on known placeholders like H3_01, H4_02, P_01, LI_01
            ###2. Pack segments into chunks under max_words
            """
            import re

            tokens = text_value.split()
            if not tokens:
                return [""]

            marker_re = re.compile(r"^(H[1-6]_\d+|P_\d+|LI_\d+)$")

            segments: list[list[str]] = []
            cur: list[str] = []
            i = 0
            while i < len(tokens):
                t = tokens[i]
                is_marker = bool(marker_re.match(t))
                if is_marker and cur:
                    segments.append(cur)
                    cur = []
                cur.append(t)
                i = i + 1
            if cur:
                segments.append(cur)

            chunks: list[str] = []
            buf: list[str] = []
            buf_words = 0

            j = 0
            while j < len(segments):
                seg = segments[j]
                seg_len = len(seg)

                if buf_words > 0 and (buf_words + seg_len) > max_words:
                    chunks.append(" ".join(buf).strip())
                    buf = []
                    buf_words = 0

                buf.extend(seg)
                buf_words = buf_words + seg_len
                j = j + 1

            if buf:
                chunks.append(" ".join(buf).strip())

            return [c for c in chunks if c]

        def _wav_duration_ms(path: Path) -> int:
            """
            ###1. Read wav frames and framerate to compute duration in ms
            """
            wf = wave.open(str(path), "rb")
            fr = wf.getnframes()
            sr = wf.getframerate()
            wf.close()
            if sr <= 0:
                return 0
            return int((fr / float(sr)) * 1000.0)

        def _concat_wavs(out_path: Path, part_paths: list[Path]) -> None:
            """
            ###1. Concatenate WAVs assuming identical params after stereo enforcement
            """
            first = wave.open(str(part_paths[0]), "rb")
            ch = first.getnchannels()
            sw = first.getsampwidth()
            sr = first.getframerate()
            first.close()

            wf_out = wave.open(str(out_path), "wb")
            wf_out.setnchannels(ch)
            wf_out.setsampwidth(sw)
            wf_out.setframerate(sr)

            k = 0
            while k < len(part_paths):
                wf = wave.open(str(part_paths[k]), "rb")
                wf_out.writeframes(wf.readframes(wf.getnframes()))
                wf.close()
                k = k + 1

            wf_out.close()

        def _shift_words(words: list[dict], index_offset: int, ms_offset: int) -> list[dict]:
            """
            ###1. Shift per-word index and timestamps for merged meta
            """
            out: list[dict] = []
            i_w = 0
            while i_w < len(words):
                w = words[i_w]
                if isinstance(w, dict):
                    w2 = dict(w)
                    idx = w2.get("index")
                    if isinstance(idx, int):
                        w2["index"] = idx + index_offset
                    s_ms = w2.get("start_ms")
                    e_ms = w2.get("end_ms")
                    if isinstance(s_ms, (int, float)):
                        w2["start_ms"] = int(s_ms) + ms_offset
                    if isinstance(e_ms, (int, float)):
                        w2["end_ms"] = int(e_ms) + ms_offset
                    s_s = w2.get("start_s")
                    e_s = w2.get("end_s")
                    if isinstance(s_s, (int, float)):
                        w2["start_s"] = float(s_s) + (ms_offset / 1000.0)
                    if isinstance(e_s, (int, float)):
                        w2["end_s"] = float(e_s) + (ms_offset / 1000.0)
                    out.append(w2)
                i_w = i_w + 1
            return out

        def _shift_placeholders(ph_list: list[dict], index_offset: int, ms_offset: int) -> list[dict]:
            """
            ###1. Shift placeholder intervals (if present) for merged meta
            """
            out: list[dict] = []
            i_p = 0
            while i_p < len(ph_list):
                p = ph_list[i_p]
                if isinstance(p, dict):
                    p2 = dict(p)
                    idx = p2.get("index")
                    if isinstance(idx, int):
                        p2["index"] = idx + index_offset
                    s_ms = p2.get("start_ms")
                    e_ms = p2.get("end_ms")
                    if isinstance(s_ms, (int, float)):
                        p2["start_ms"] = int(s_ms) + ms_offset
                    if isinstance(e_ms, (int, float)):
                        p2["end_ms"] = int(e_ms) + ms_offset
                    out.append(p2)
                i_p = i_p + 1
            return out
        def _generate_wav_parts_and_merge() -> Path:
            """
            ###1. Split text into safe chunks and generate part WAVs
            ###2. Align each part and merge meta by shifting time/index offsets
            ###3. Write final WAV and meta, then append HTML metadata
            """
            lock_dir = _PathAlias(output_path).parent / (output_path.name + ".lockdir")
            lock_dir.mkdir(parents=True, exist_ok=False)

            approx = _approx_token_count(canonical_text)
            print("[TTS][TOKENS] approx_tokens=", approx)

            def _split_by_word_count(text_value: str, max_words: int) -> list[str]:
                """
                ###1. Hard-split by word count when marker-based splitting yields 1 chunk
                """
                toks = text_value.split()
                if not toks:
                    return []
                chunks: list[str] = []
                i = 0
                while i < len(toks):
                    j = i + max_words
                    chunk = " ".join(toks[i:j]).strip()
                    if chunk:
                        chunks.append(chunk)
                    i = j
                return chunks

            max_words = 900
            parts_text = _split_on_block_markers(canonical_text, max_words=max_words)

            if len(parts_text) <= 1:
                parts_text = _split_by_word_count(canonical_text, max_words=max_words)

            if len(parts_text) <= 1:
                _notify(20, "requesting audio from model")
                with client.audio.speech.with_streaming_response.create(
                        model=model,
                        voice=voice,
                        input=canonical_text,
                        instructions=voice_instructions,
                        response_format="wav",
                ) as response:
                    response.stream_to_file(output_path)

                if not output_path.exists():
                    raise RuntimeError("[TTS] expected wav missing after generation: " + str(output_path))

                wav_size = int(output_path.stat().st_size)
                if wav_size < 64:
                    raise RuntimeError("[TTS] wav too small after generation: " + str(output_path) + " size=" + str(wav_size))

                _ensure_stereo_wav(output_path)
                _notify(60, "generating transcripts and alignment")
                _run_alignment_and_metadata(
                    output_path,
                    canonical_text,
                    meta_path=meta_path,
                    placeholder_meta=placeholder_meta,
                    section_id=section_id,
                    voice=voice_id,
                    voice_instructions=voice_instructions,
                    model=model_id,
                    aligner=aligner,
                )
                _ensure_tts_text_in_meta(meta_path, canonical_text)
                _append_html_metadata(output_path, meta_path)

                _notify(100, "done")
                lock_dir.rmdir()
                return output_path

            print("[TTS][CHUNK] parts=", len(parts_text))

            part_paths: list[Path] = []
            part_meta_paths: list[Path] = []

            parent_dir = _PathAlias(output_path).parent
            if not parent_dir.exists():
                parent_dir.mkdir(parents=True, exist_ok=True)

            p = 0
            while p < len(parts_text):
                part_stem = f"{stem}_part{p + 1:02d}"
                part_wav = base_folder / f"{part_stem}_{voice_id}_{model_id}.wav"
                part_meta = part_wav.with_suffix(part_wav.suffix + ".json")

                part_paths.append(part_wav)
                part_meta_paths.append(part_meta)

                if (
                        part_wav.exists()
                        and part_wav.stat().st_size > 64
                        and part_meta.exists()
                        and part_meta.stat().st_size > 64
                ):
                    p = p + 1
                    continue

                _notify(20, "requesting audio (part " + str(p + 1) + "/" + str(len(parts_text)) + ")")
                with client.audio.speech.with_streaming_response.create(
                        model=model,
                        voice=voice,
                        input=parts_text[p],
                        instructions=voice_instructions,
                        response_format="wav",
                ) as response:
                    response.stream_to_file(part_wav)

                if not part_wav.exists():
                    raise RuntimeError("[TTS] expected part wav missing after generation: " + str(part_wav))

                part_size = int(part_wav.stat().st_size)
                if part_size < 64:
                    raise RuntimeError("[TTS] part wav too small after generation: " + str(part_wav) + " size=" + str(part_size))

                _ensure_stereo_wav(part_wav)
                _notify(60, "aligning (part " + str(p + 1) + "/" + str(len(parts_text)) + ")")

                _run_alignment_and_metadata(
                    part_wav,
                    parts_text[p],
                    meta_path=part_meta,
                    placeholder_meta=placeholder_meta,
                    section_id=section_id,
                    voice=voice_id,
                    voice_instructions=voice_instructions,
                    model=model_id,
                    aligner=aligner,
                )
                _ensure_tts_text_in_meta(part_meta, parts_text[p])
                _ensure_tts_markers_in_meta(part_meta, placeholder_meta)

                p = p + 1

            _notify(75, "merging part WAVs")
            _concat_wavs(output_path, part_paths)

            if not output_path.exists():
                raise RuntimeError("[TTS] expected merged wav missing after concat: " + str(output_path))

            merged_size = int(output_path.stat().st_size)
            if merged_size < 64:
                raise RuntimeError("[TTS] merged wav too small after concat: " + str(output_path) + " size=" + str(merged_size))

            _ensure_stereo_wav(output_path)

            _notify(85, "merging metadata")
            merged_words: list[dict] = []
            merged_placeholders: list[dict] = []
            merged_root: dict = {}

            idx_offset = 0
            ms_offset = 0

            q = 0
            while q < len(part_meta_paths):
                meta_obj = json.loads(part_meta_paths[q].read_text(encoding="utf-8"))
                if not merged_root:
                    merged_root = dict(meta_obj)

                words = meta_obj.get("words") or []
                placeholders = meta_obj.get("placeholders") or meta_obj.get("placeholder_intervals") or []

                shifted_words = _shift_words(words, idx_offset, ms_offset)
                merged_words.extend(shifted_words)

                shifted_ph: list[dict] = []
                if isinstance(placeholders, list):
                    shifted_ph = _shift_placeholders(placeholders, idx_offset, ms_offset)
                    merged_placeholders.extend(shifted_ph)

                last_idx = idx_offset
                if shifted_words:
                    last = shifted_words[-1].get("index")
                    if type(last) is int:
                        last_idx = last + 1

                idx_offset = last_idx
                ms_offset = ms_offset + _wav_duration_ms(part_paths[q])
                q = q + 1

            merged_root["words"] = merged_words
            if merged_placeholders:
                merged_root["placeholders"] = merged_placeholders

            merged_root["tts_text"] = canonical_text

            meta_path.write_text(json.dumps(merged_root, ensure_ascii=False, indent=2), encoding="utf-8")
            _append_html_metadata(output_path, meta_path)

            _notify(100, "done")
            lock_dir.rmdir()
            return output_path

        if output_path.exists():
            size_existing = output_path.stat().st_size
            if size_existing > 0 and meta_path.exists() and meta_path.stat().st_size > 0:
                _notify(100, "cache hit (audio and metadata already exist)")
                return output_path

            if size_existing > 0 and (not meta_path.exists() or meta_path.stat().st_size == 0):
                _notify(35, "audio already present on disk; rebuilding metadata")
                _ensure_stereo_wav(output_path)
                _run_alignment_and_metadata(
                    output_path,
                    canonical_text,
                    meta_path=meta_path,
                    placeholder_meta=placeholder_meta,
                    section_id=section_id,
                    voice=voice_id,
                    voice_instructions=voice_instructions,
                    model=model_id,
                    aligner=aligner,
                )
                _ensure_tts_markers_in_meta(meta_path, placeholder_meta)
                _append_html_metadata(output_path, meta_path)

                _notify(100, "done")
                return output_path

            if size_existing == 0:
                output_path.unlink()

        words_count = len(canonical_text.split())
        chars_count = len(canonical_text)

        approx_tokens = _approx_token_count(canonical_text)

        print(
            "[TTS][TOKENS]",
            "approx_tokens=",
            approx_tokens,
            "words=",
            words_count,
            "chars=",
            chars_count,
        )

        over_limit_risk = False
        if approx_tokens >= 1600:
            over_limit_risk = True
        if words_count >= 1200:
            over_limit_risk = True
        if chars_count >= 7500:
            over_limit_risk = True

        if over_limit_risk:
            print("[TTS][TOKENS] over limit risk → chunking")
            return _generate_wav_parts_and_merge()

        parent_dir = _PathAlias(output_path).parent
        if not parent_dir.exists():
            parent_dir.mkdir(parents=True, exist_ok=True)

        _notify(20, "requesting audio from model")
        with client.audio.speech.with_streaming_response.create(
                model=model,
                voice=voice,
                input=canonical_text,
                instructions=voice_instructions,
                response_format="wav",
        ) as response:
            response.stream_to_file(output_path)

        _ensure_stereo_wav(output_path)
        _notify(60, "generating transcripts and alignment")
        _run_alignment_and_metadata(
            output_path,
            canonical_text,
            meta_path=meta_path,
            placeholder_meta=placeholder_meta,
            section_id=section_id,
            voice=voice_id,
            voice_instructions=voice_instructions,
            model=model_id,
            aligner=aligner,
        )
        _append_html_metadata(output_path, meta_path)
        _notify(100, "done")
        return output_path


import wave
from pathlib import Path

from openai import OpenAI


def _build_html_from_tts_meta(meta, placeholder_meta):
    """
    Guarantees:

    (1) Words are the source of truth: output order is meta['words'] order.
        Whitespace between tokens is reconstructed from meta['tts_text'] gaps.

    (2) Structural tags are deterministic:
        blocks (heading/paragraph/list_item) are mapped to token-index ranges,
        and tags open/close by token index, not by char/event interleaving.

    (3) Placeholders are replaced by exact HTML anchors:
        anchor['text'] (e.g. "(Hobe, 2018, p. 12)") is re-found in tts_text,
        then mapped to token indices, then emitted as anchor HTML once,
        consuming the covered tokens so their inner text is not duplicated.

    (4) CSS injected and meta['tts_html_body/html/css/stats'] updated.
    """
    words = meta["words"]
    tts_text = meta["tts_text"]

    blocks = placeholder_meta["blocks"]
    anchors = placeholder_meta["anchors"]

    def _escape_html(txt: str) -> str:
        return (
            txt.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
        )

    def _strip_tags_to_text(html_in: str) -> str:
        import re
        s = str(html_in or "")
        s = re.sub(r"<[^>]+>", "", s)
        s = s.replace("\u00a0", " ")
        return s

    def _norm_ms(v):
        if type(v) is int:
            return v
        if type(v) is float:
            return int(v)
        return 0

    def _extract_ms_pair(w_item: dict) -> tuple[int, int]:
        s = w_item.get("start_ms")
        e = w_item.get("end_ms")

        if s is None:
            s = w_item.get("start")
            if type(s) is float or type(s) is int:
                s = float(s) * 1000.0
        if e is None:
            e = w_item.get("end")
            if type(e) is float or type(e) is int:
                e = float(e) * 1000.0

        s_ms = _norm_ms(s)
        e_ms = _norm_ms(e)
        if e_ms < s_ms:
            e_ms = s_ms
        if e_ms == s_ms:
            e_ms = s_ms + 1
        return int(s_ms), int(e_ms)

    def _is_ws(ch: str) -> bool:
        return ch == " " or ch == "\t" or ch == "\n" or ch == "\r"

    def _skip_ws(pos: int) -> int:
        n = len(tts_text)
        i = int(pos)
        while i < n and _is_ws(tts_text[i]):
            i = i + 1
        return int(i)

    def _align_tokens_to_text(words_list: list, text: str) -> list[dict]:
        """
        Returns token_spans aligned sequentially into tts_text:
        {tok_i, index, word, start_ms, end_ms, char_start, char_end}
        char_end is EXCLUSIVE.
        """
        out = []
        cursor = 0
        n = len(text)

        i = 0
        while i < len(words_list):
            w_item = words_list[i]
            token = w_item["word"]
            token_s = str(token).strip()
            if token_s == "":
                i = i + 1
                continue

            cursor = _skip_ws(cursor)
            if cursor >= n:
                break

            found = text.find(token_s, cursor)
            if found < 0:
                raise RuntimeError("[TTS][HTML] token not found in tts_text: " + repr(token_s))

            s_ms, e_ms = _extract_ms_pair(w_item)
            idx_raw = w_item.get("index")
            if type(idx_raw) is float:
                idx_raw = int(idx_raw)
            if type(idx_raw) is not int:
                idx_raw = int(i)

            out.append(
                {
                    "tok_i": int(i),
                    "index": int(idx_raw),
                    "word": token_s,
                    "start_ms": int(s_ms),
                    "end_ms": int(e_ms),
                    "char_start": int(found),
                    "char_end": int(found + len(token_s)),
                }
            )
            cursor = int(found + len(token_s))
            i = i + 1

        return out

    token_spans = _align_tokens_to_text(words, tts_text)
    if len(token_spans) == 0:
        raise RuntimeError("[TTS][HTML] no token spans aligned; cannot build html")

    def _inclusive_end_to_exclusive(start_incl: int, end_incl: int) -> tuple[int, int]:
        s = int(start_incl)
        e = int(end_incl)
        if e < s:
            e = s
        e = e + 1
        if s < 0:
            s = 0
        if e < 0:
            e = 0
        if s > len(tts_text):
            s = len(tts_text)
        if e > len(tts_text):
            e = len(tts_text)
        if e < s:
            e = s
        return int(s), int(e)

    def _refind_anchor_span(anchor_text: str, approx_start: int) -> tuple[int, int]:
        """
        Prefer local window near approx_start. If not found, search globally.
        If not present in this tts_text at all (common with chunked TTS parts),
        return (-1, -1) so the caller can skip this anchor.
        """
        t = str(anchor_text or "").strip()
        if t == "":
            return -1, -1

        a0 = int(approx_start)
        if a0 < 0:
            a0 = 0
        if a0 > len(tts_text):
            a0 = len(tts_text)

        win_left = a0 - 64
        win_right = a0 + 512
        if win_left < 0:
            win_left = 0
        if win_right > len(tts_text):
            win_right = len(tts_text)

        hay = tts_text[win_left:win_right]
        rel = hay.find(t)
        if rel >= 0:
            s = int(win_left + rel)
            e = int(s + len(t))
            return int(s), int(e)

        s_global = tts_text.find(t)
        if s_global < 0:
            return -1, -1

        e_global = int(s_global + len(t))
        return int(s_global), int(e_global)

    def _token_index_for_char(pos: int) -> int:
        """
        First token whose [char_start,char_end) covers pos, else nearest.
        """
        p = int(pos)
        if p <= int(token_spans[0]["char_start"]):
            return 0
        if p >= int(token_spans[-1]["char_end"]):
            return len(token_spans) - 1

        i = 0
        while i < len(token_spans):
            t = token_spans[i]
            cs = int(t["char_start"])
            ce = int(t["char_end"])
            if p < cs:
                return i
            if p >= cs and p < ce:
                return i
            i = i + 1
        return len(token_spans) - 1

    # Build anchor intervals in token-index space: [tok_start, tok_end] inclusive
    # Skip anchors whose visible text is not present in THIS tts_text (chunked parts).
    anchor_intervals = []
    i_a = 0
    while i_a < len(anchors):
        a = anchors[i_a]

        raw_s = int(a["tts_char_start"])
        raw_e = int(a["tts_char_end"])
        a_s0, a_e0 = _inclusive_end_to_exclusive(raw_s, raw_e)

        a_text = a.get("text") or _strip_tags_to_text(a.get("html") or "")
        a_text = str(a_text).strip()

        found_s, found_e = _refind_anchor_span(a_text, a_s0)
        if found_s < 0 or found_e < 0:
            i_a = i_a + 1
            continue

        tok_s = _token_index_for_char(found_s)
        tok_e = _token_index_for_char(found_e - 1)
        if tok_e < tok_s:
            tok_e = tok_s

        s_ms = int(token_spans[tok_s]["start_ms"])
        e_ms = int(token_spans[tok_e]["end_ms"])
        if e_ms < s_ms:
            e_ms = s_ms + 1

        anchor_intervals.append(
            {
                "tok_start": int(tok_s),
                "tok_end": int(tok_e),
                "start_ms": int(s_ms),
                "end_ms": int(e_ms),
                "html": str(a.get("html") or a_text),
                "text": str(a_text),
                "block_id": str(a.get("block_id") or ""),
            }
        )
        i_a = i_a + 1

    anchor_intervals.sort(key=lambda d: int(d["tok_start"]))

    # Index anchors by tok_start for O(1) emission in token loop
    anchors_by_start = {}
    i_a = 0
    while i_a < len(anchor_intervals):
        it = anchor_intervals[i_a]
        k = int(it["tok_start"])
        if k not in anchors_by_start:
            anchors_by_start[k] = []
        anchors_by_start[k].append(it)
        i_a = i_a + 1

    # Build consumed token set (all tokens covered by any anchor interval)
    consumed = set()
    i_a = 0
    while i_a < len(anchor_intervals):
        it = anchor_intervals[i_a]
        j = int(it["tok_start"])
        while j <= int(it["tok_end"]):
            consumed.add(int(j))
            j = j + 1
        i_a = i_a + 1

    # Build blocks as token ranges.
    # Preferred: marker-based boundaries from tts_text_marked (deterministic).
    # Fallback: plain tts_char_start/end spans from placeholder_meta blocks (non-marker).
    tts_text_marked = placeholder_meta.get("tts_text_marked")
    if type(tts_text_marked) is not str or tts_text_marked.strip() == "":
        tts_text_marked = meta.get("tts_text_marked")

    blocks_norm = []

    use_markers = True
    if type(tts_text_marked) is not str or tts_text_marked.strip() == "":
        use_markers = False

    if use_markers:
        token_spans_marked = _align_tokens_to_text(words, tts_text_marked)
        if len(token_spans_marked) == 0:
            use_markers = False

    if use_markers:
        marker_prefix = placeholder_meta.get("marker_prefix")
        if type(marker_prefix) is not str or marker_prefix == "":
            marker_prefix = meta.get("marker_prefix")
        if type(marker_prefix) is not str or marker_prefix == "":
            marker_prefix = "⟦"

        marker_suffix = placeholder_meta.get("marker_suffix")
        if type(marker_suffix) is not str or marker_suffix == "":
            marker_suffix = meta.get("marker_suffix")
        if type(marker_suffix) is not str or marker_suffix == "":
            marker_suffix = "⟧"

        def _skip_ws_marked(pos: int) -> int:
            n = len(tts_text_marked)
            i = int(pos)
            while i < n and _is_ws(tts_text_marked[i]):
                i = i + 1
            return int(i)

        def _token_index_for_char_marked(pos: int) -> int:
            """
            First token whose [char_start,char_end) covers pos in MARKED alignment, else nearest.
            """
            p = int(pos)
            if p <= int(token_spans_marked[0]["char_start"]):
                return 0
            if p >= int(token_spans_marked[-1]["char_end"]):
                return len(token_spans_marked) - 1

            i = 0
            while i < len(token_spans_marked):
                t = token_spans_marked[i]
                cs = int(t["char_start"])
                ce = int(t["char_end"])
                if p < cs:
                    return i
                if p >= cs and p < ce:
                    return i
                i = i + 1
            return len(token_spans_marked) - 1

        marker_hits = []
        search_from = 0
        i_b = 0
        while i_b < len(blocks):
            b = blocks[i_b]
            bid = str(b.get("id") or "")
            if bid == "":
                raise RuntimeError("[TTS][HTML] block missing id; cannot locate marker")

            marker = str(marker_prefix) + bid + str(marker_suffix)

            pos = tts_text_marked.find(marker, int(search_from))
            if pos < 0:
                raise RuntimeError("[TTS][HTML] marker not found in tts_text_marked: " + repr(marker))

            marker_end = int(pos + len(marker))
            content_start = _skip_ws_marked(marker_end)

            marker_hits.append(
                {
                    "block": b,
                    "marker_pos": int(pos),
                    "content_start": int(content_start),
                }
            )

            search_from = int(marker_end)
            i_b = i_b + 1

        i_b = 0
        while i_b < len(marker_hits):
            cur = marker_hits[i_b]
            if i_b < len(marker_hits) - 1:
                nxt = marker_hits[i_b + 1]
                cur["content_end"] = int(nxt["marker_pos"])
            else:
                cur["content_end"] = int(len(tts_text_marked))
            i_b = i_b + 1

        i_b = 0
        while i_b < len(marker_hits):
            h = marker_hits[i_b]
            b = h["block"]

            cs = int(h["content_start"])
            ce = int(h["content_end"])
            if ce < cs:
                ce = cs

            tok_s = _token_index_for_char_marked(cs)
            tok_e = _token_index_for_char_marked(ce - 1)
            if tok_e < tok_s:
                tok_e = tok_s

            blocks_norm.append(
                {
                    "type": str(b["type"]),
                    "level": int(b.get("level") or 0),
                    "id": str(b.get("id") or ""),
                    "tok_start": int(tok_s),
                    "tok_end": int(tok_e),
                }
            )
            i_b = i_b + 1

    if not use_markers:
        # Fallback: use plain tts_char spans from blocks (already computed at TTS-text build time).
        i_b = 0
        while i_b < len(blocks):
            b = blocks[i_b]
            bs_raw = int(b["tts_char_start"])
            be_raw = int(b["tts_char_end"])
            bs, be = _inclusive_end_to_exclusive(bs_raw, be_raw)

            tok_s = _token_index_for_char(bs)
            tok_e = _token_index_for_char(be - 1)
            if tok_e < tok_s:
                tok_e = tok_s

            blocks_norm.append(
                {
                    "type": str(b["type"]),
                    "level": int(b.get("level") or 0),
                    "id": str(b.get("id") or ""),
                    "tok_start": int(tok_s),
                    "tok_end": int(tok_e),
                }
            )
            i_b = i_b + 1

    blocks_norm.sort(key=lambda d: int(d["tok_start"]))

    i_b = 0
    while i_b < len(blocks_norm) - 1:
        cur = blocks_norm[i_b]
        nxt = blocks_norm[i_b + 1]
        if int(cur["tok_end"]) >= int(nxt["tok_start"]):
            cur["tok_end"] = int(nxt["tok_start"]) - 1
            if int(cur["tok_end"]) < int(cur["tok_start"]):
                cur["tok_end"] = int(cur["tok_start"])
        i_b = i_b + 1

    if len(blocks_norm) > 0:
        last_tok = len(token_spans) - 1
        if int(blocks_norm[-1]["tok_end"]) > int(last_tok):
            blocks_norm[-1]["tok_end"] = int(last_tok)
        if int(blocks_norm[-1]["tok_end"]) < int(blocks_norm[-1]["tok_start"]):
            blocks_norm[-1]["tok_end"] = int(blocks_norm[-1]["tok_start"])

    # Prepare block pointer indexed by token index
    block_ptr = 0
    cur_block = None
    cur_block_end = -1
    cur_tag = ""

    in_ul = False
    chunks = []

    def _open_block(b):
        nonlocal in_ul
        btype = str(b["type"])
        bid = str(b["id"] or "")
        if btype != "list_item":
            if in_ul:
                chunks.append("</ul>")
                in_ul = False

        if btype == "heading":
            lvl = int(b["level"])
            if lvl < 1:
                lvl = 2
            if lvl > 6:
                lvl = 6
            tag = "h" + str(lvl)
            chunks.append("<" + tag + ' id="' + _escape_html(bid) + '">')
            return tag

        if btype == "paragraph":
            chunks.append('<p id="' + _escape_html(bid) + '">')
            return "p"

        if btype == "list_item":
            if not in_ul:
                chunks.append("<ul>")
                in_ul = True
            chunks.append('<li id="' + _escape_html(bid) + '">')
            return "li"

        chunks.append('<p id="' + _escape_html(bid) + '">')
        return "p"

    def _close_tag(tag_name: str):
        if tag_name == "":
            return
        if tag_name == "li":
            chunks.append("</li>")
            return
        chunks.append("</" + tag_name + ">")

    def _prefix_from_text(prev_char_end: int, cur_char_start: int) -> str:
        if int(cur_char_start) <= int(prev_char_end):
            return ""
        gap = tts_text[int(prev_char_end):int(cur_char_start)]
        j = 0
        while j < len(gap):
            if not _is_ws(gap[j]):
                return ""
            j = j + 1
        return " "

    def _span_html(prefix: str, idx_raw: int, start_ms: int, end_ms: int, inner_html: str, kind: str) -> str:
        attrs = []
        attrs.append('data-tts-index="' + _escape_html(str(idx_raw)) + '"')
        attrs.append('data-tts-start-ms="' + str(int(start_ms)) + '"')
        attrs.append('data-tts-end-ms="' + str(int(end_ms)) + '"')
        attrs.append('data-tts-kind="' + _escape_html(kind) + '"')
        return prefix + "<span " + " ".join(attrs) + ">" + inner_html + "</span>"

    stats = {
        "tokens": int(len(token_spans)),
        "blocks": int(len(blocks_norm)),
        "anchors": int(len(anchor_intervals)),
        "emitted_word_spans": 0,
        "emitted_anchor_spans": 0,
    }

    prev_char_end = int(token_spans[0]["char_start"])

    tok_i = 0
    while tok_i < len(token_spans):
        # open new block if needed
        if cur_block is None:
            if block_ptr < len(blocks_norm) and int(blocks_norm[block_ptr]["tok_start"]) == int(tok_i):
                cur_block = blocks_norm[block_ptr]
                cur_block_end = int(cur_block["tok_end"])
                cur_tag = _open_block(cur_block)
                block_ptr = block_ptr + 1

        # If blocks have gaps, enforce that tokens still render (but without wrapping tag)
        # This is intentional: word stream remains source of truth.
        # You can optionally force a paragraph wrapper here if you want.

        # anchor emission if anchor starts here: emit once, and skip to tok_end+1
        if tok_i in anchors_by_start:
            # if multiple anchors start at same token, emit in order of longest first (avoid nesting races)
            items = anchors_by_start[tok_i]
            # stable sort by tok_end desc
            j = 0
            while j < len(items) - 1:
                k = j + 1
                while k < len(items):
                    if int(items[k]["tok_end"]) > int(items[j]["tok_end"]):
                        tmp = items[j]
                        items[j] = items[k]
                        items[k] = tmp
                    k = k + 1
                j = j + 1

            a = items[0]
            ts = token_spans[int(a["tok_start"])]
            te = token_spans[int(a["tok_end"])]

            prefix = _prefix_from_text(int(prev_char_end), int(ts["char_start"]))
            span = _span_html(
                prefix,
                int(a["tok_start"]),
                int(a["start_ms"]),
                int(a["end_ms"]),
                str(a["html"]),
                "anchor",
            )
            chunks.append(span)
            stats["emitted_anchor_spans"] = int(stats["emitted_anchor_spans"]) + 1

            prev_char_end = int(te["char_end"])

            tok_i = int(a["tok_end"]) + 1

            # close block if the anchor jumped past the end
            if cur_block is not None and tok_i > int(cur_block_end):
                _close_tag(cur_tag)
                cur_block = None
                cur_block_end = -1
                cur_tag = ""
            continue

        # skip token if consumed by an anchor interval
        if tok_i in consumed:
            prev_char_end = int(token_spans[tok_i]["char_end"])
            tok_i = tok_i + 1
            if cur_block is not None and tok_i > int(cur_block_end):
                _close_tag(cur_tag)
                cur_block = None
                cur_block_end = -1
                cur_tag = ""
            continue

        t = token_spans[tok_i]
        prefix = _prefix_from_text(int(prev_char_end), int(t["char_start"]))
        inner = _escape_html(str(t["word"]))
        chunks.append(
            _span_html(
                prefix,
                int(t["index"]),
                int(t["start_ms"]),
                int(t["end_ms"]),
                inner,
                "word",
            )
        )
        stats["emitted_word_spans"] = int(stats["emitted_word_spans"]) + 1
        prev_char_end = int(t["char_end"])

        tok_i = tok_i + 1

        # close block if ended
        if cur_block is not None and tok_i > int(cur_block_end):
            _close_tag(cur_tag)
            cur_block = None
            cur_block_end = -1
            cur_tag = ""

    if cur_tag != "":
        _close_tag(cur_tag)

    if in_ul:
        chunks.append("</ul>")
        in_ul = False

    html_body = "".join(chunks).strip()

    css_paper = meta.get("tts_css") or ""
    css_paper = str(css_paper)
    if css_paper.strip() == "":
        css_paper = """
        html, body { background: #0E1220; color: #E8EDF5; margin: 0; }
        .paper {
          max-width: 820px;
          margin: 18px auto;
          padding: 36px 46px;
          background: #111622;
          border: 1px solid #242C3B;
          border-radius: 12px;
          box-shadow: 0 10px 28px rgba(0,0,0,0.42);
          font-family: 'Times New Roman', Georgia, 'DejaVu Serif', serif;
          font-size: 16px;
          line-height: 1.85;
          letter-spacing: 0.15px;
        }
        .paper p, .paper h1, .paper h2, .paper h3, .paper h4,
        .paper ul, .paper ol, .paper li, .paper blockquote,
        .paper table, .paper th, .paper td, .paper pre, .paper code,
        .paper figure, .paper figcaption, .paper hr {
          background: transparent; color: #E8EDF5; border-color: #242C3B;
        }
        .paper h1, .paper h2, .paper h3, .paper h4 {
          font-weight: 700;
          line-height: 1.22;
          margin: 1.35em 0 0.65em 0;
        }
        .paper h1 { font-size: 28px; margin-top: 0.25em; }
        .paper h2 { font-size: 22px; }
        .paper h3 { font-size: 19px; font-weight: 650; }
        .paper h4 { font-size: 17px; font-weight: 650; }
        .paper p { margin: 0 0 1.35em 0; text-align: justify; }
        .paper ul, .paper ol { margin: 0 0 1.25em 1.45em; padding: 0; }
        .paper li { margin: 0.35em 0; }
        .paper a, .paper a * { color: #9CB8FF !important; text-decoration: underline; }
        .paper a:visited, .paper a:visited * { color: #9CB8FF !important; }
        .paper a:hover, .paper a:hover * { color: #B6C8FF !important; }
        """

    full_doc = (
        "<html><head><meta charset='utf-8'/>"
        "<style>" + css_paper + "</style>"
        "</head><body><div class='paper'>"
        + html_body
        + "</div></body></html>"
    )

    meta["tts_css"] = css_paper
    meta["tts_html_body"] = html_body
    meta["tts_html"] = full_doc
    meta["tts_html_stats"] = stats

    return full_doc


def _append_html_metadata(audio_path: Path, meta_path: Path) -> None:
    """
    ###1. Load sidecar JSON and placeholder_meta (blocks/anchors with tts_char spans)
    ###2. Rebuild timed HTML from meta['tts_text'] + meta['words'] + placeholder_meta
    ###3. Persist full HTML + stats into sidecar
    ###4. Build placeholders_timing as ANCHOR timing spans (for refs-off skipping), no marker tokens required
    ###5. Print verification after write
    """
    import json
    from typing import Any

    print(
        "[TTS][HTML-META] append_html_metadata audio_path=",
        str(audio_path),
        "meta_path=",
        str(meta_path),
        "exists=",
        meta_path.is_file(),
    )

    if not meta_path.is_file():
        print("[TTS][HTML-META] abort: meta_path does not exist")
        return

    with meta_path.open("r", encoding="utf-8") as f_in:
        meta_raw = json.load(f_in)

    if type(meta_raw) is not dict:
        print("[TTS][HTML-META] abort: meta JSON not a dict")
        return

    words = meta_raw.get("words") or []
    if type(words) is not list or len(words) == 0:
        print("[TTS][HTML-META] abort: meta 'words' missing or empty")
        return

    # This must exist now; it is the canonical spoken text.
    tts_text = meta_raw.get("tts_text")
    if type(tts_text) is not str or tts_text.strip() == "":
        raise RuntimeError("[TTS][HTML-META] missing meta['tts_text'] (canonical TTS input)")

    placeholder_meta = meta_raw.get("placeholder_meta")
    if placeholder_meta is None:
        placeholder_meta = meta_raw.get("placeholders")
    if placeholder_meta is None:
        placeholder_meta = meta_raw.get("anchors")

    if type(placeholder_meta) is not dict:
        raise RuntimeError("[TTS][HTML-META] placeholder_meta must be a dict with blocks/anchors")

    # Promote marker fields into meta_raw when present in placeholder_meta (enables marker-based HTML rebuild).
    tts_text_marked = placeholder_meta.get("tts_text_marked")
    if type(tts_text_marked) is str and tts_text_marked.strip() != "":
        meta_raw["tts_text_marked"] = tts_text_marked

    marker_prefix = placeholder_meta.get("marker_prefix")
    if type(marker_prefix) is str and marker_prefix != "":
        meta_raw["marker_prefix"] = marker_prefix

    marker_suffix = placeholder_meta.get("marker_suffix")
    if type(marker_suffix) is str and marker_suffix != "":
        meta_raw["marker_suffix"] = marker_suffix

    if type(placeholder_meta) is not dict:
        raise RuntimeError("[TTS][HTML-META] placeholder_meta must be a dict with blocks/anchors")

    # Ensure required shape
    blocks = placeholder_meta.get("blocks")
    anchors = placeholder_meta.get("anchors")
    if type(blocks) is not list:
        raise RuntimeError("[TTS][HTML-META] placeholder_meta['blocks'] missing or not a list")
    if type(anchors) is not list:
        raise RuntimeError("[TTS][HTML-META] placeholder_meta['anchors'] missing or not a list")

    # Rebuild enriched HTML (sets meta_raw['tts_html*'] + stats)
    rebuilt_full = _build_html_from_tts_meta(meta_raw, placeholder_meta)
    if type(rebuilt_full) is not str or rebuilt_full.strip() == "":
        print("[TTS][HTML-META] abort: _build_html_from_tts_meta produced empty HTML")
        return

    # Build placeholders_timing as anchor spans for refs-off skipping
    def _norm_ms(v: Any) -> int:
        if type(v) is int:
            return v
        if type(v) is float:
            return int(v)
        return 0

    def _extract_ms_pair(w_item: dict) -> tuple[int, int]:
        s = w_item.get("start_ms")
        e = w_item.get("end_ms")

        if s is None:
            s = w_item.get("start")
            if type(s) is float or type(s) is int:
                s = float(s) * 1000.0
        if e is None:
            e = w_item.get("end")
            if type(e) is float or type(e) is int:
                e = float(e) * 1000.0

        s_ms = _norm_ms(s)
        e_ms = _norm_ms(e)
        if e_ms < s_ms:
            e_ms = s_ms
        if e_ms == s_ms:
            e_ms = s_ms + 1
        return s_ms, e_ms

    # Align words sequentially into tts_text to map tokens -> char spans
    def _align_tokens(words_list: list, text: str) -> list[dict]:
        out = []
        cursor = 0
        n = len(text)

        def _is_ws(ch: str) -> bool:
            return ch == " " or ch == "\t" or ch == "\n" or ch == "\r"

        def _skip_ws(pos: int) -> int:
            i = pos
            while i < n and _is_ws(text[i]):
                i = i + 1
            return i

        i = 0
        while i < len(words_list):
            w_item = words_list[i]
            tok = w_item.get("word") or ""
            tok_s = str(tok).strip()
            if tok_s == "":
                i = i + 1
                continue

            cursor = _skip_ws(cursor)
            if cursor >= n:
                break

            found = text.find(tok_s, cursor)
            if found < 0:
                raise RuntimeError("[TTS][HTML-META] token not found in tts_text: " + repr(tok_s))

            s_ms, e_ms = _extract_ms_pair(w_item)
            out.append(
                {
                    "i": int(i),
                    "word": tok_s,
                    "start_ms": int(s_ms),
                    "end_ms": int(e_ms),
                    "char_start": int(found),
                    "char_end": int(found + len(tok_s)),
                }
            )

            cursor = int(found + len(tok_s))
            i = i + 1

        return out

    token_spans = _align_tokens(words, tts_text)

    placeholders_timing = []
    a_i = 0
    while a_i < len(anchors):
        a = anchors[a_i]
        a_s = int(a["tts_char_start"])
        a_e = int(a["tts_char_end"])
        if a_e < a_s:
            a_e = a_s

        min_s = None
        max_e = None

        t_i = 0
        while t_i < len(token_spans):
            t = token_spans[t_i]
            ts = int(t["char_start"])
            te = int(t["char_end"])
            if te <= a_s:
                t_i = t_i + 1
                continue
            if ts >= a_e:
                break

            if min_s is None or int(t["start_ms"]) < int(min_s):
                min_s = int(t["start_ms"])
            if max_e is None or int(t["end_ms"]) > int(max_e):
                max_e = int(t["end_ms"])

            t_i = t_i + 1

        if min_s is None:
            min_s = 0
        if max_e is None:
            max_e = int(min_s) + 1

        placeholders_timing.append(
            {
                "index": int(a_i),
                "word": str(a.get("id") or a.get("placeholder") or "A"),
                "start_ms": int(min_s),
                "end_ms": int(max_e),
            }
        )
        a_i = a_i + 1

    placeholders_timing.sort(key=lambda d: (int(d["start_ms"]), int(d["index"])))

    meta_raw["placeholders_timing"] = placeholders_timing

    tts_html = meta_raw["tts_html"]
    tts_body = meta_raw["tts_html_body"]
    css_paper = meta_raw["tts_css"]

    with meta_path.open("w", encoding="utf-8") as f_out:
        json.dump(meta_raw, f_out, ensure_ascii=False, indent=2)

    has_paper = ("<div class='paper'>" in tts_html) or ('<div class="paper">' in tts_html)
    has_style = "<style>" in tts_html
    has_tts_span = "data-tts-kind" in tts_html
    has_anchor = 'data-tts-kind="anchor"' in tts_html or "data-tts-kind='anchor'" in tts_html

    print(
        "[TTS][HTML-META][OK] wrote:",
        str(meta_path),
        "tts_html_len=",
        len(tts_html),
        "tts_body_len=",
        len(tts_body),
        "css_len=",
        len(css_paper),
        "paper=",
        has_paper,
        "style=",
        has_style,
        "tts_span=",
        has_tts_span,
        "anchor_span=",
        has_anchor,
        "placeholders_timing=",
        len(placeholders_timing),
        "stats=",
        meta_raw.get("tts_html_stats"),
    )


def extract_placeholders_timing(words):
    result = []
    i = 0
    while i < len(words):
        w = words[i]
        token = w.get("word","")
        if isinstance(token,str) and token.startswith("[") and token.endswith("]"):
            result.append({
                "index": w.get("index"),
                "placeholder": token,
                "start_ms": w.get("start_ms"),
                "end_ms": w.get("end_ms"),
                "aligned_source": "ctc/mfa"  # values originate from aligner output
            })
        i = i + 1
    return result

def _safe_name(s: str) -> str:
    """
    ###1. Normalise
    ###2. Replace unsafe chars with _
    ###3. Collapse repeats
    """
    s2 = (s or "").strip()
    if s2 == "":
        return "tts"
    out = []
    last_us = False
    for ch in s2:
        if ch.isalnum():
            out.append(ch.lower())
            last_us = False
        elif ch in (" ", "-", "—", "_"):
            if not last_us:
                out.append("_")
                last_us = True
        else:
            continue
    if not out:
        return "tts"
    s3 = "".join(out)
    while "__" in s3:
        s3 = s3.replace("__", "_")
    s3 = s3.strip("_")
    return s3 or "tts"


def debug_play_word_attribution() -> None:
    """
    ###1. Use cached WAV if present (zero network latency)
    ###2. If needed, fetch 24kHz PCM once and wrap it into a 24kHz WAV (no resample)
    ###3. Play via winsound.PlaySound on Windows
    """
    import winsound

    word = "attribution"
    voice = "alloy"
    model = "gpt-4o-mini-tts"

    base_folder = Path.home() / "AcAssistant_audio"
    base_folder.mkdir(parents=True, exist_ok=True)

    stem = f"word_{_safe_name(word)}_{voice}_{model}"
    pcm_path = base_folder / f"{stem}.pcm"
    wav_path = base_folder / f"{stem}_win.wav"

    print("[DBG] base_folder:", base_folder)
    print("[DBG] target pcm:", pcm_path)
    print("[DBG] target wav:", wav_path)

    if wav_path.is_file():
        size_bytes = wav_path.stat().st_size
        print("[DBG] cached WAV found, size bytes:", size_bytes)
    else:
        if pcm_path.is_file():
            print("[DBG] cached PCM found, will wrap into WAV without network call")
            pcm_bytes = pcm_path.read_bytes()
        else:
            print("[DBG] requesting PCM from OpenAI (24kHz, 16-bit LE mono)")
            client = OpenAI(api_key=os.getenv("OPENAI_API_KEY") or "")
            with client.audio.speech.with_streaming_response.create(
                model=model,
                voice=voice,
                input=word,
                response_format="pcm",
            ) as response:
                response.stream_to_file(pcm_path)
            pcm_bytes = pcm_path.read_bytes()

        pcm_len = len(pcm_bytes)
        print("[DBG][PCM] bytes:", pcm_len)
        if pcm_len == 0:
            print("[DBG] ERROR: empty PCM, abort")
            return

        channels = 1
        sample_width = 2
        sample_rate = 24000
        frames = pcm_len // (channels * sample_width)

        print("[DBG] wrapping raw 24kHz PCM into WAV (no resampling)")
        with wave.open(str(wav_path), "wb") as wf:
            wf.setnchannels(channels)
            wf.setsampwidth(sample_width)
            wf.setframerate(sample_rate)
            wf.writeframes(pcm_bytes)

        size_bytes = wav_path.stat().st_size
        print("[DBG] wav written, size bytes:", size_bytes)

    with wave.open(str(wav_path), "rb") as wf:
        ch = wf.getnchannels()
        sw = wf.getsampwidth()
        sr = wf.getframerate()
        frames = wf.getnframes()
        dur = frames / float(sr) if sr > 0 else 0.0

    print("[DBG][WAV] channels:", ch)
    print("[DBG][WAV] sample_width_bytes:", sw)
    print("[DBG][WAV] sample_rate_hz:", sr)
    print("[DBG][WAV] frames:", frames)
    print("[DBG][WAV] duration_s:", dur)

    if os.name == "nt":
        print("[DBG] playing via winsound.PlaySound (SND_FILENAME)")
        winsound.PlaySound(str(wav_path), winsound.SND_FILENAME)
    else:
        print("[DBG] non-Windows OS, skipping winsound playback")


def load_prompt_config(key, config_file=PROMPT_CONFIG_FILE):
    """Loads task-specific configuration from the JSON file."""
    default_return = {"prompt": "", "default_model": {}}  # default_model is now dict
    if not config_file.is_file():
        print(f"Error: Prompt config file '{config_file.resolve()}' not found.")
        return default_return
    try:
        with open(config_file, 'r', encoding='utf-8') as f:
            config_data = json.load(f)
        task_config = config_data.get(key)
        if not task_config:
            print(f"Warning: No config for key '{key}'. Using defaults.")
            return default_return

        # Ensure default_model is a dict, handle old format gracefully
        if "default_model" not in task_config or not isinstance(task_config["default_model"], dict):
            if "default_model" in task_config:  # If old string format exists, warn and ignore
                print(f"Warning: 'default_model' for key '{key}' is not a dictionary. Ignoring.")
            task_config["default_model"] = {}  # Set to empty dict


        # Return merged dict with defaults for missing keys
        return {**default_return, **task_config}  # Merge ensures all keys exist

    except Exception as e:
        print(f"Error loading prompt config '{config_file.resolve()}': {e}")
        return default_return

def call_models(ai: str, models: dict, text: str, function_key: str,
                document: str = None, vision: bool = False,
                dynamic_image_path: Path | str | None = None,

                base_output_dir: Path | None = None,
                *,
                # batching controls
                collection_name: str = "default",
                batch_read: bool = False,
                batch_store_only: bool = False,
                batch_by_index: int | None = None,
                batch_custom_id: str | None = None,
                batch_root: Path | str | None = None):
    """
    Generates response from AI model, handling vision (Gemini w/ Pillow) & docs (Mistral).
    Also supports OpenAI-batch file paths: read/store-only/online modes.
    """
    print(f"DEBUG: call_models invoked with function_key='{function_key}'")

    all_responses = []

    # --- load task config & assemble prompt ---
    task_config = load_prompt_config(function_key)
    task_prompt = task_config.get("prompt", "")
    task_default_models = task_config.get("default_model", {})
    full_prompt = f"{text}\n\n{task_prompt}".strip()
    openai_schema = task_config.get("openai_tool_schema")

    # ========== BATCHING PATHS (OpenAI Responses style) ==========
    import os, re, json
    def _safe_batch_root():
        env_root = os.getenv("BATCH_ROOT")
        if env_root:
            return Path(env_root).expanduser().resolve()
        if batch_root is not None:
            return Path(batch_root).expanduser().resolve()
        base = Path(base_output_dir) if base_output_dir else Path.cwd()
        return (base / "batches").resolve()

    def _sanitize(s: str) -> str:
        return re.sub(r"[^A-Za-z0-9_.-]+", "_", (s or "task")).strip("_")

    # ----- derive EFFECTIVE batch args from toggle envs -----
    env_store = os.getenv("BATCH_MODE_STORE_ONLY", "0") == "1"
    env_read  = os.getenv("BATCH_MODE_READ", "0") == "1"
    env_func  = os.getenv("BATCH_FUNCTION") or None
    env_coll  = os.getenv("BATCH_COLLECTION") or None

    eff_function_key = env_func or function_key
    eff_collection   = _sanitize(env_coll or collection_name or "collection")
    eff_batch_store_only = bool(batch_store_only or env_store)
    eff_batch_read       = bool(batch_read or env_read)

    eff_batch_root = _safe_batch_root()
    eff_function_dir = _sanitize(eff_function_key or "task")

    func_dir = eff_batch_root / eff_function_dir
    try:
        func_dir.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        print(f"WARNING: failed to create batch dir '{func_dir}': {e}")

    input_file = func_dir / f"{eff_collection}_extract_na_input.jsonl"
    output_file = func_dir / f"{eff_collection}_extract_na_output.jsonl"

    # ---------- read mode ----------
    if eff_batch_read:
        try:
            response = read_completion_results(
                custom_id=batch_custom_id,
                path=str(output_file),
                function=eff_function_key,
                by_index=batch_by_index
            )
            if response:
                print(f"DEBUG: Read {len(response)} responses from {output_file}")
                return response
            print(f"DEBUG: No responses found in {output_file}. Proceeding to generate new responses.")
        except NameError:
            print("WARNING: read_completion_results is not available in scope; skipping batch read.")
        except Exception as e:
            print(f"WARNING: batch_read failed: {e}")

    # ---------- store-only (prepare JSONL, do NOT call API now) ----------
    if eff_batch_store_only:
        try:
            schema_wrapper = {
                "name": (openai_schema.get("name") if isinstance(openai_schema, dict) else eff_function_key) or eff_function_key,
                "schema": openai_schema,
            }
            batch_request = prepare_batch_requests(
                text_to_send=full_prompt,
                content=task_prompt,
                schema_wrapper=schema_wrapper,
                model=(models.get("openai") or task_default_models.get("openai") or "gpt-5-mini"),
                custom_id=batch_custom_id or f"{eff_function_key}:{eff_collection}",
            )
            write_batch_requests_to_file(batch_request=batch_request, file_name=str(input_file))
            return batch_request, False
        except NameError:
            print("WARNING: prepare_batch_requests/write_batch_requests_to_file not found; writing minimal JSONL.")
            try:
                payload = {
                    "custom_id": batch_custom_id or f"{eff_function_key}:{eff_collection}",
                    "function": eff_function_key,
                    "request": {
                        "model": (models.get("openai") or task_default_models.get("openai") or "gpt-4o-mini"),
                        "input": [
                            {"type": "message", "role": "system", "content": task_prompt},
                            {"type": "message", "role": "user", "content": full_prompt},
                        ],
                        "text": {
                            "format": {
                                "type": "json_schema",
                                "name": (openai_schema.get("name") if isinstance(openai_schema, dict) else eff_function_key) or eff_function_key,
                                "schema": openai_schema,
                                "strict": True,
                            }
                        }
                    }
                }
                with open(input_file, "a", encoding="utf-8") as f:
                    f.write(json.dumps(payload, ensure_ascii=False) + "\n")
                return {"path": str(input_file), "count": 1, "fallback_minimal": True}, False
            except Exception as e:
                raise ValueError(f"Failed to write minimal batch JSONL to {input_file}: {e}") from e
        except Exception as e:
            raise

    # --- Determine Image Path & Validate ---
    actual_image_path = None
    if vision:
        if dynamic_image_path:
            current_image_path = Path(dynamic_image_path)
            if base_output_dir and not current_image_path.is_absolute():
                actual_image_path = (base_output_dir / current_image_path).resolve()
            else:
                actual_image_path = current_image_path.resolve()
            if not actual_image_path.is_file():
                error_msg = f"Error: Dynamic image path non-existent: '{actual_image_path}' for key '{function_key}'"
                print(error_msg);
                providers_to_run = [ai] if ai != "all" else ["mistral", "openai", "gemini"]
                return [{"provider": p, "error": error_msg} for p in providers_to_run if
                        p != "deepseek"] if ai == "all" else {"provider": ai, "error": error_msg}
            print(f"  Using resolved dynamic image path: {actual_image_path}")
        else:
            error_msg = f"Error: Vision mode enabled but no dynamic_image_path provided for key '{function_key}'."
            print(error_msg);
            providers_to_run = [ai] if ai != "all" else ["mistral", "openai", "gemini"]
            return [{"provider": p, "error": error_msg} for p in providers_to_run if
                    p != "deepseek"] if ai == "all" else {"provider": ai, "error": error_msg}

    # --- Input Validation (DeepSeek Vision, Document Provider) ---
    # ... (validation logic remains the same) ...
    if vision and ai == "deepseek":
        new_msg = ""
    if document and ai != 'mistral' and ai != 'all':
        print(f"Warning: Document processing only for Mistral. Ignoring document for '{ai}'.")
        document = None

    # --- Prepare Vision Data (Base64 & PIL) ---
    # ... (vision data prep logic remains the same) ...
    base64_image, mime_type = None, None
    pil_image_for_gemini = None
    if vision and actual_image_path:
        print(f"  Preparing image data: {actual_image_path.name}")
        base64_image, mime_type = encode_image_to_base64(str(actual_image_path))
        if not base64_image:
            error_msg = f"Error: Failed to encode image '{actual_image_path}'."
            providers_to_run = [ai] if ai != "all" else ["mistral", "openai", "gemini"]
            return [{"provider": p, "error": error_msg} for p in providers_to_run if
                    p != "deepseek"] if ai == "all" else {"provider": ai, "error": error_msg}
        if GEMINI_ENABLED and PIL:
            try:
                pil_image_for_gemini = PIL.Image.open(actual_image_path)
            except Exception as e:
                print(f"Warning: Could not open image with PIL for Gemini: {e}")

    mistral_document_url_for_chat = None
    if document and (ai == 'mistral' or ai == 'all'):
        if not MISTRAL_ENABLED or not Mistral or not MISTRAL_API_KEY:
            print("Error: Mistral client/library not configured for document processing.")
            if ai == 'mistral': return {"provider": "mistral", "error": "Mistral client not configured"}
            document = None
        elif document:
            print(f"  Processing document for Mistral: {document}")
            try:
                if document.startswith("http"):
                    mistral_document_url_for_chat = document
                elif document.lower().endswith(".pdf") and Path(document).is_file():
                    print("    ** Mistral file upload placeholder: Logic needed here. **");
                    document = None
                else:
                    print(f"Warning: Document path '{document}' not valid. Skipping."); document = None
            except Exception as e:
                print(f"Error during Mistral document processing setup: {e}"); document = None

    # --- Determine Providers to Run ---
    # ... (provider determination logic remains the same) ...
    providers_to_execute = []
    if ai == "all":
        providers_to_execute = ["mistral", "openai", "gemini", "deepseek"]
    elif ai in ["mistral", "openai", "gemini", "deepseek"]:
        providers_to_execute = [ai]
    else:
        raise ValueError(f"Unsupported AI provider: {ai}")

    # --- Iterate and Call Providers ---
    for provider in providers_to_execute:
        response_data = {"provider": provider}

        # --- Select Model and Temperature (Using Provider-Specific Defaults) ---
        current_model = models.get(provider)  # 1. Check input dict
        if not current_model:
            current_model = task_default_models.get(provider)  # 2. Check task config for this provider
        if not current_model:  # 3. Apply hardcoded provider default
            if provider == "mistral":
                current_model = "mistral-large-latest"
            elif provider == "openai":
                current_model = "gpt-5-mini"
            elif provider == "gemini":
                current_model = "gemini-1.5-pro-latest"  # Adjust if needed
            elif provider == "deepseek":
                current_model = "deepseek-chat"
            print(f"  Using hardcoded default model for {provider}: {current_model}")

        # --- End Model/Temp Selection ---

        print(f"\n--- Calling Provider: {provider} ---")
        if vision and actual_image_path: print(f"  Vision Input: Yes (Image: {actual_image_path.name})")
        if document and provider == 'mistral' and mistral_document_url_for_chat:
            print(f"  Document Input: Yes (Doc URL: {mistral_document_url_for_chat})")
        elif document and provider == 'mistral':
            print(f"  Document Input: Skipped (Issue processing)")

        try:
            # --- Mistral ---
            if provider == "mistral":
                # ... (Mistral API call logic using client.chat.complete - keep as corrected before) ...
                if not MISTRAL_ENABLED or not Mistral or not MISTRAL_API_KEY: raise ImportError(
                    "Mistral client/library not installed or API key missing.")
                client = Mistral(api_key=MISTRAL_API_KEY)
                message_content = [{"type": "text", "text": full_prompt}]
                if vision and base64_image: message_content.append(
                    {"type": "image_url", "image_url": f"data:{mime_type};base64,{base64_image}"})
                if mistral_document_url_for_chat: message_content.append(
                    {"type": "document_url", "document_url": mistral_document_url_for_chat})
                mistral_messages = [
                    {"role": "user", "content": message_content if len(message_content) > 1 else full_prompt}]
                chat_response = client.chat.complete(model=current_model, messages=mistral_messages,
                                                    )
                if chat_response.choices and chat_response.choices[0].message:
                    response_data["response"] = chat_response.choices[0].message.content
                else:
                    raise ValueError("Mistral response structure unexpected.")


            # --- OpenAI ---
            elif provider == "openai":
                if not OpenAI or not OPENAI_API_KEY: raise ImportError("OpenAI client not configured.")
                client = OpenAI(api_key=OPENAI_API_KEY, timeout=90.0, max_retries=1)

                # Prepare base message payload (always list format)
                openai_message_content_payload = [{"type": "text", "text": full_prompt}]
                if vision and base64_image:
                    openai_message_content_payload.append(
                        {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{base64_image}"}}
                    )

                # --- API Call Args ---
                api_args = {
                    "model": current_model,
                    "messages": [{"role": "user", "content": openai_message_content_payload}],
                }

                if openai_schema and isinstance(openai_schema, dict) and "name" in openai_schema:
                    print(f"    INFO: Using OpenAI tool schema: {openai_schema['name']}")
                    api_args["tools"] = [{"type": "function", "function": openai_schema}]
                    # Force the model to use the specified tool
                    api_args["tool_choice"] = {"type": "function", "function": {"name": openai_schema["name"]}}
                else:
                    print("    INFO: No OpenAI tool schema found or schema invalid, using standard text completion.")
                    if openai_schema:  # Log if schema existed but was invalid
                        print(f"    WARNING: Invalid OpenAI schema structure provided: {openai_schema}")

                # --- Make API Call ---
                response = client.chat.completions.create(**api_args)

                # --- Process Response (Check for Tool Call) ---
                message = response.choices[0].message
                if message.tool_calls:
                    print("    INFO: Received tool call response from OpenAI.")
                    # Expecting one tool call based on tool_choice='required' implicit behavior or specific choice
                    tool_call = message.tool_calls[0]
                    if tool_call.type == "function" and tool_call.function.name == openai_schema["name"]:
                        arguments_str = tool_call.function.arguments
                        try:
                            # Parse the JSON string from the arguments
                            parsed_args = json.loads(arguments_str)
                            # Extract the actual list we want based on the schema definition
                            response_data["response"] = parsed_args.get("extracted_items", [])  # Default to empty list
                            print(
                                f"    SUCCESS: Parsed tool arguments. Extracted {len(response_data['response'])} items.")
                        except json.JSONDecodeError as json_e:
                            raise ValueError(
                                f"Failed to parse JSON arguments from OpenAI tool call: {json_e}. Arguments received: '{arguments_str}'")
                    else:
                        raise ValueError(
                            f"Unexpected tool call type or name received: {tool_call.type} / {getattr(tool_call.function, 'name', 'N/A')}")
                elif message.content:
                    # Handle standard text response if no tool was called (or if schema wasn't used)
                    print("    INFO: Received standard text response from OpenAI.")
                    response_data["response"] = message.content
                else:
                    # Handle cases like finish_reason='tool_calls' but tool_calls array is empty/missing? Or other content filtering.
                    raise ValueError("OpenAI response missing expected content or tool calls.")


            # --- Gemini (Using Correct Import and GenerativeModel) ---
            elif provider == "gemini":
                # Use the GEMINI_ENABLED flag set during import checks
                # if not GEMINI_ENABLED:
                #     raise ImportError("Gemini client/library/Pillow not available or API key missing.")

                # API Key is configured globally now via genai.configure()
                # No need for genai.Client() here when using GenerativeModel directly

                # --- Construct Contents List Directly ---
                gemini_contents = [str(full_prompt)]  # Start with text prompt as string
                if vision and pil_image_for_gemini:
                    print("    Appending PIL image directly to Gemini contents.")
                    gemini_contents.append(pil_image_for_gemini)  # Add PIL image object directly
                elif vision:
                    # Close image if PIL failed during prep before raising error
                    if pil_image_for_gemini and hasattr(pil_image_for_gemini, 'close'): pil_image_for_gemini.close()
                    raise ValueError("Gemini vision requested but PIL image preparation failed.")

                # --- Generation Config ---
                gen_config = genai_types.GenerationConfig(  # Use imported genai_types
                ) if genai_types else None

                # --- Call API using genai.GenerativeModel ---
                print(f"    Calling genai.GenerativeModel for model: {current_model}")
                try:
                    # Instantiate the model directly using the imported genai
                    client = genai.Client(api_key=GEMINI_API_KEY)  # Don't need 'models/' prefix here

                    response = client.models.generate_content(
                        contents=gemini_contents,  # Pass the list with text and PIL image
                        model=current_model,
                        # config=gen_config,
                        # stream=False
                    )
                except Exception as api_err:
                    # Close image before raising error
                    if pil_image_for_gemini and hasattr(pil_image_for_gemini, 'close'): pil_image_for_gemini.close()
                    raise ValueError(f"Gemini API call failed for model '{current_model}': {api_err}") from api_err

                # Close PIL image if it was opened
                if pil_image_for_gemini and hasattr(pil_image_for_gemini, 'close'):
                    try:
                        pil_image_for_gemini.close()
                    except Exception as close_err:
                        print(f"Info: Non-critical error closing PIL image: {close_err}")

                # --- Check Response ---
                # (Response checking logic remains the same)
                if hasattr(response, 'text') and response.text:
                    response_data["response"] = response.text
                elif hasattr(response, 'parts') and response.parts:
                    response_data["response"] = "".join(part.text for part in response.parts if hasattr(part, 'text'))
                    if not response_data["response"]: raise ValueError(
                        "Gemini response parts generated but contain no text.")
                else:
                    feedback = response.prompt_feedback if hasattr(response, 'prompt_feedback') else "N/A";
                    finish_reason = response.candidates[0].finish_reason if hasattr(response,
                                                                                    'candidates') and response.candidates else 'N/A';
                    safety = response.candidates[0].safety_ratings if hasattr(response,
                                                                              'candidates') and response.candidates else 'N/A'
                    raise ValueError(
                        f"No valid text content from Gemini. Finish:{finish_reason}, Safety:{safety}, Feedback:{feedback}")

            # --- DeepSeek ---
            elif provider == "deepseek":
                # ... (DeepSeek logic as before) ...
                if not OpenAI or not DEEPSEEK_API_KEY: raise ImportError("DeepSeek client not configured.")
                text = NO_VISION_MSG + full_prompt if vision else full_prompt

                client = OpenAI(api_key=DEEPSEEK_API_KEY, base_url="https://api.deepseek.com")
                response = client.chat.completions.create(model=current_model,
                                                          messages=[{"role": "system", "content": "You are helpful."},
                                                                    {"role": "user", "content": text}],
                                                         stream=False)
                response_data["response"] = response.choices[0].message.content

            # --- Add successful response ---
            if ai == "all":
                all_responses.append(response_data)
            else:
                return response_data

        # --- Error Handling (Keep as before) ---
        except ImportError as imp_err:
            error_message = f"{imp_err}"
            print(f"  Configuration Error for {provider}: {error_message}")
            response_data["error"] = error_message
            if ai == "all":
                all_responses.append(response_data)
            else:
                return response_data
        except Exception as e:
            error_message = f"Error calling {provider} model '{current_model}': {e}"
            print(f"  {error_message}")
            response_data["error"] = f"Model '{current_model}': {e}"
            if ai == "all":
                all_responses.append(response_data)
            else:
                return response_data
        finally:
            # Ensure PIL image is closed if Gemini was called and used it
            if provider == "gemini" and 'pil_image_for_gemini' in locals() and pil_image_for_gemini and hasattr(
                    pil_image_for_gemini, 'fp') and pil_image_for_gemini.fp:
                try:
                    pil_image_for_gemini.close()
                except Exception:
                    pass

    # --- Return results ---
    if not providers_to_execute: raise ValueError("No valid AI providers specified or available.")
    return all_responses if ai == "all" else all_responses[0] if all_responses else {"provider": ai,
                                                                                     "error": "Provider execution failed."}
# manual_input = "/Users/pantera/Zotero/storage/V4PQ962B/6LM42EYM.pdf" # <--- CHANGE THIS
#
# text = extract_robust_pdf_text(manual_input)
# prompt= f"""*Prompt*:
# 1. Read through the entire academic paper thoroughly.
# 2. In your reading, identify the following key components:
#    - Stud*Prompt*:
#
# 1. *Thoroughly Review the Provided Paper*: Ignore all special formatting (such as  callout boxes, footnotes, or references) and focus solely on the paper’s main content. Do not add or invent details not present in the document.
#
# 2. *Extract Key Components*: Identify only from the paper’s content:
#    - *Study Objectives*: The main aims or goals of the research.
#    - *Research Problem*: The central issue or challenge addressed.
#    - *Research Questions*: The primary inquiries guiding the study.
#    - *Methodology*: How the research was carried out, including data sources or analytical approaches.
#    - *Key Findings*: The most significant results or insights derived from the study.
#    - *Limitations*: Any constraints, weaknesses, or factors that might affect the study’s conclusions.
#    - *Future Research Directions*: Proposed avenues or suggestions for continuing investigation.
#
# 3. *Create a Single-Paragraph Abstract (250–300 Words)*: Summarize these elements into a coherent and self-contained paragraph without:
#    - Adding information not explicitly stated in the paper.
#    - Using direct quotations.
#    - Including references or in-text citations.
#    - Exceeding 300 words or dropping below 250 words.
#
# 4. *Maintain Clarity and Academic Tone*: Present the abstract in plain, concise language that reflects standard academic writing. The final output must be:
#    - Strictly derived from the paper’s content.
#    - Free of any special formatting (headings, bullet points, bold, italics).
#    maintain the author writing style and lexical
# *Desired Output*:
# A self-contained, single-paragraph abstract (300–350 words) accurately summarizing the paper’s content, based solely on the information given in the text, without added details or external knowledge.
#    text=[[{text}]]"""
#
# #
# if _name_ == "_main_":
#     # Create a models dictionary with providers mapped to model names.
#     models_dict = {
#         "openai": "gpt-4o",
#         "gemini": "gemini-2.5-pro-exp-03-25",  # default for gemini
#         "deepseek": "deepseek-chat"  # default for deepseek; can be changed to 'deepseek-reasoner'
#     }
#     # Request responses from all AI providers using the above dictionary.
#     result = generate_prompt(ai="all", models=models_dict, prompt=prompt)
#     for item in result:
#         if "response" in item:
#             print(f"{item['provider']} response: {item['response']}")
#         else:
#             print(f"{item['provider']} error: {item['error']}")
def safe_name(s: str, *, maxlen: int = 120) -> str:
    s = "" if s is None else str(s)
    s = s.strip()

    # Replace Windows-reserved characters and collapse whitespace
    s = re.sub(r'[\\/:*?"<>|]+', "_", s)
    s = re.sub(r"\s+", "_", s)

    # Convert dots to underscores to avoid trailing-dot problems
    s = s.replace(".", "_")

    # Keep conservative charset
    s = re.sub(r"[^0-9A-Za-z_-]+", "_", s)

    # Remove repeated underscores
    s = re.sub(r"_+", "_", s)

    # Strip leading/trailing underscores, dots, spaces (Windows dislikes trailing . or space)
    s = s.strip(" _.")
    if not s:
        s = "default"

    # Trim length
    if len(s) > maxlen:
        h = hashlib.sha1(s.encode("utf-8")).hexdigest()[:8]
        s = f"{s[:maxlen-9]}_{h}"

    return s

PROMPTS_CONFIG = {}
PROMPTS_FILENAME = "api_prompts.json"

def _ui_pre(s: str) -> str:
    import html as _html
    return f"<pre style='white-space:pre-wrap;word-break:break-word;margin:0'>{_html.escape(s or '')}</pre>"


script_dir = Path(__file__).parent
logging.info(f"Attempting to load {PROMPTS_FILENAME}. Current script directory: {script_dir}")
repo_root = Path(__file__).resolve().parents[2]
candidate_prompt_paths = [
    repo_root / "electron_zotero" / "api_prompts.json",
    repo_root / "my-electron-app" / "electron_zotero" / "api_prompts.json",
    repo_root / "electron_zotero" / "prompts.json",
    repo_root / "my-electron-app" / "electron_zotero" / "prompts.json",
    script_dir.parent.parent / "prompts.json",
]
logging.info("Prompt candidates: " + ", ".join(str(p) for p in candidate_prompt_paths))

found_prompts_file_path = None
for candidate in candidate_prompt_paths:
    if candidate.exists() and candidate.is_file():
        found_prompts_file_path = candidate
        break
if found_prompts_file_path:
    logging.info(f"Found prompt file at: {found_prompts_file_path}")
else:
    logging.error(f"CRITICAL: no prompt file found in candidates for {PROMPTS_FILENAME}.")

if found_prompts_file_path:
    import json
    try:
        with open(found_prompts_file_path, 'r', encoding='utf-8') as f:
            PROMPTS_CONFIG = json.load(f)
        logging.info(
            f"Successfully loaded and parsed prompts from {found_prompts_file_path} into ai_services.")
        logging.info(f"Loaded {len(PROMPTS_CONFIG)} prompt configurations. Keys found: {list(PROMPTS_CONFIG.keys())}")
    except json.JSONDecodeError as e:
        logging.error(
            f"CRITICAL: Error decoding {found_prompts_file_path}. Check JSON. Details: {e}. Using fallbacks (empty prompts).")
        PROMPTS_CONFIG = {}
    except Exception as e:
        logging.error(f"CRITICAL: Unexpected error loading {found_prompts_file_path}: {e}. Using fallbacks (empty prompts).")
        PROMPTS_CONFIG = {}
else:
    logging.error(
        f"CRITICAL: {PROMPTS_FILENAME} could not be located. Using fallbacks (empty prompts).")
    PROMPTS_CONFIG = {}


try:
    import openai

    OPENAI_CLIENT_AVAILABLE = True
    logging.info("OpenAI library found for ai_services.")
except ImportError:
    OPENAI_CLIENT_AVAILABLE = False
    logging.warning("OpenAI library not found. AI calls will use stubs. 'pip install openai'.")


    class OpenAIClientMock:
        class Chat:
            class Completions:
                @staticmethod
                def create(*args, **kwargs):
                    logging.warning(f"OpenAIClientMock: Chat.Completions.create (STUB) model {kwargs.get('model')}.")
                    model = kwargs.get("model", "stub_model");
                    prompt = kwargs.get("messages", [{}])[0].get("content", "")

                    class ChoiceMock: __init__ = lambda s, t: setattr(s, 'message',
                                                                      type('o', (object,), {'content': t}))

                    class ResponseMock: __init__ = lambda s, t, m: setattr(s, 'choices', [ChoiceMock(t)]) or setattr(s,
                                                                                                                     'model',
                                                                                                                     m) or setattr(
                        s, 'usage', type('o', (object,), {'total_tokens': 0}))

                    if "json" in prompt.lower(): return ResponseMock(
                        "{\"stub_key\":\"Stub JSON from ai_services mock\"}", model)
                    return ResponseMock(f"STUB (ai_services mock): Response for '{model}' prompt: '{prompt[:50]}...'",
                                        model)

            completions = Completions()

        chat = Chat()


    openai = type('obj', (object,),
                  {'OpenAI': lambda **kwargs: OpenAIClientMock(), 'APIError': type('E', (Exception,), {})})()


def _get_prompt_details(
        prompt_key: str,
        ai_provider_key: str,
        default_model_override: str | None = None,
        template_vars: dict | None = None,  # caller-supplied vars (e.g., {"context": ...})
        results_so_far: dict | None = None,  # ONLY to inject RQ/AP for a section
        section_id: str | None = None,  # explicit section id; else derive from results_so_far
):
    """
    Returns a 5-tuple, in this exact order:
      0) prompt_template : str   (already formatted if template_vars is provided)
      1) chosen_model    : str
      2) max_tokens      : int
      3) json_schema     : dict | None
      4) effort          : str | None

    Note: This function does NOT build the overall {context}. It only injects
    section-specific Research Question and Additional Prompt.
    """
    import logging
    from string import Formatter

    def _safe_format(template: str, values: dict) -> str:
        class _SafeDict(dict):
            def __missing__(self, key):
                return "{" + key + "}"

        try:
            return template.format_map(_SafeDict(values or {}))
        except Exception as e:
            logging.debug(f"format_map failed for '{prompt_key}': {e}. Attempting manual fill.")
            needed = {f[1] for f in Formatter().parse(template) if f and f[1]}
            provided = set((values or {}).keys())
            missing = needed - provided
            s = template
            for m in missing:
                s = s.replace("{" + m + "}", "{" + m + "}")
            try:
                return s.format(**(values or {}))
            except Exception:
                return template

    def _fallback():
        tpl = f"Fallback: {prompt_key}. Context: {{context}}"
        if template_vars:
            try:
                tpl = _safe_format(tpl, template_vars)
            except Exception as e:
                logging.warning(f"Fallback formatting failed for '{prompt_key}': {e}")
        return (
            tpl,
            default_model_override or "gpt-5-mini",
            1500,
            None,
            None,
        )

    # ---- fetch config ----
    if not PROMPTS_CONFIG:
        logging.warning(f"prompts.json not loaded. Using fallback for {prompt_key}.")
        return _fallback()

    config = PROMPTS_CONFIG.get(prompt_key)
    if not config:
        logging.warning(
            f"Prompt key '{prompt_key}' not in prompts.json. Fallback. Loaded keys: {list(PROMPTS_CONFIG.keys())}"
        )
        return _fallback()

    prompt_template = config.get("prompt", f"Error: Prompt for '{prompt_key}' missing in config.")

    # ---- model selection ----
    final_model = default_model_override
    if not final_model:
        dm_dict = config.get("default_model", {})
        if isinstance(dm_dict, dict):
            final_model = dm_dict.get(ai_provider_key, dm_dict.get("openai", "gpt-5-mini"))
        elif isinstance(dm_dict, str):
            final_model = dm_dict
        else:
            final_model = "gpt-5-mini"
            logging.warning(f"Invalid 'default_model' for '{prompt_key}'. Using {final_model}.")

    # ---- token limit / schema / effort ----
    try:
        max_tokens = int(config.get("max_tokens", 2000))
    except Exception:
        max_tokens = 2000
    json_schema = config.get("json_schema")
    effort = config.get("effort")

    # ---- derive ONLY RQ/AP from results_so_far ----
    derived_vars = {}
    if isinstance(results_so_far, dict):
        sec_id = section_id or results_so_far.get("active_section_id") or results_so_far.get("current_section_id") \
                 or (results_so_far.get("section_step_key") or "").lower()

        rq_map = results_so_far.get("rq_by_section", {})
        ap_map = results_so_far.get("additional_prompt_by_section", {})

        rq = (rq_map.get(sec_id) or "").strip() if sec_id else ""
        ap = (ap_map.get(sec_id) or "").strip() if sec_id else ""

        # both raw and block forms (blocks are convenient for templates)
        derived_vars = {
            "research_question": rq,
            "additional_prompt": ap,
            "rq": rq,
            "ap": ap,
            "rq_block": f"Research question/problem:\n{rq}\n" if rq else "",
            "additional_prompt_block": f"Additional prompt:\n{ap}\n" if ap else "",
        }

    # ---- merge caller vars with derived RQ/AP (caller wins on conflict) ----
    merged_vars = dict(derived_vars)
    if template_vars:
        merged_vars.update(template_vars)

    # ---- format template (no overall context added here) ----
    try:
        prompt_template = _safe_format(prompt_template, merged_vars)
    except Exception as e:
        logging.warning(f"Template formatting failed for '{prompt_key}': {e}")

    return (prompt_template, final_model, max_tokens, json_schema, effort)


def read_completion_results(custom_id, path, function, model=None, by_index=None):
    """
    Returns (processed_content, usage_dict_or_None)

    usage_dict has:
      {
        "input_tokens": int,
        "output_tokens": int,
        "total_tokens": int,
        "cost_usd": float,
        "model": "<model>",
        "is_batch": True
      }
    If nothing matched, returns (None, None).
    """
    import json

    if not os.path.exists(path):
        print(f"Error: Output file not found at '{path}'")
        return None, None

    try:
        with open(path, 'r', encoding='utf-8') as f:
            for line_number, line in enumerate(f, start=1):
                stripped_line = line.strip()
                if not stripped_line:
                    continue
                try:
                    data = json.loads(stripped_line)
                except json.JSONDecodeError:
                    print(f"Warning: Skipping malformed JSON at line {line_number}.")
                    continue

                # match by index OR by custom_id
                if by_index is not None:
                    if (line_number - 1) != by_index:
                        continue
                else:
                    if data.get("custom_id") != custom_id:
                        continue

                # --- extract content text (best effort) ---
                try:
                    output_list = data["response"]["body"]["output"]
                    message_obj = [it for it in output_list if it.get("type") == "message"][-1]
                    content_str = message_obj["content"][0]["text"]
                except Exception as e:
                    print(f"Failed to extract message: {e}")
                    return None, None

                # parse vs return raw depending on `function`
                if function == "paper":
                    processed = content_str
                else:
                    try:
                        parsed_content = json.loads(content_str)
                    except json.JSONDecodeError:
                        processed = content_str
                    else:
                        processed = parsed_content.get('result') if function == "topic_sentence" else parsed_content

                # --- usage & cost (BATCH) ---
                body = data.get("response", {}).get("body", {})
                usage = body.get("usage", {}) if isinstance(body, dict) else {}
                input_toks = usage.get("input_tokens") or usage.get("prompt_tokens", 0) or 0
                output_toks = usage.get("output_tokens") or usage.get("completion_tokens", 0) or 0
                model_name = model or body.get("model") or "unknown"
                cost_usd = _estimate_cost_usd(input_toks, output_toks, model_name, is_batch=True)

                usage_dict = {
                    "input_tokens": int(input_toks),
                    "output_tokens": int(output_toks),
                    "total_tokens": int(input_toks) + int(output_toks),
                    "cost_usd": float(cost_usd),
                    "model": model_name,
                    "is_batch": True,
                }
                return processed, usage_dict

        print(f"Info: No matching record found (custom_id='{custom_id}', by_index={by_index}).")
        return None, None

    except Exception as e:
        print(f"Unexpected error while reading the file: {e}")
        return None, None


from pathlib import Path
import base64, os,  logging
def _canonical_csv(df, max_chars: int = 20000) -> str:
    """
    Make the CSV prompt-stable across runs:
      - consistent column ordering (alphabetical by column name)
      - coerce numerics; round floats; strip strings
      - stable row ordering (mergesort on all columns as strings)
      - Unix newlines
    """
    import pandas as pd

    if df is None or getattr(df, "empty", True):
        return ""

    # Work on a copy
    d = df.copy()

    # Ensure columns exist and are sortable
    cols = list(d.columns)
    cols_sorted = sorted(cols, key=lambda s: str(s))

    # Coerce columns for comparability and stable sort keys
    for c in cols_sorted:
        # Try numeric first
        s = pd.to_numeric(d[c], errors="coerce")
        if s.notna().any():
            # numeric column
            d[c] = s.round(6)  # round floats for stability
        else:
            # treat as text (incl. NaN→"")
            d[c] = d[c].astype(str).str.strip()

    # Reorder columns
    d = d[cols_sorted]

    # Sort rows deterministically by all columns as strings (stable mergesort)
    sort_keys = [c for c in cols_sorted]
    d_for_sort = d.astype(str)
    d = d.iloc[d_for_sort.sort_values(sort_keys, kind="mergesort").index]

    csv = d.to_csv(index=False, lineterminator="\n")
    return csv[:max_chars] + ("\n# …TRUNCATED…" if len(csv) > max_chars else "")


def _stable_cache_dir(base_logs_dir: str | None) -> str:
    """
    Choose a repeatable cache directory that doesn't depend on Path.cwd().
    Prefer a project/logs root if provided; else, anchor to the repo (or home).
    """
    from pathlib import Path
    if base_logs_dir:
        root = Path(base_logs_dir)
    else:
        # fallback: repo-ish anchor (parent of this file) or home
        try:
            root = Path(__file__).resolve().parents[1]
        except Exception:
            root = Path.home()
    p = root / ".annotarium_llm_cache"
    p.mkdir(parents=True, exist_ok=True)
    return str(p)
os.environ.setdefault("ANNOTARIUM_CACHE_DIR",
                      r"C:\Users\luano\Downloads\annotarium_package (1)\annotarium_package\.annotarium_llm_cache")
def call_models_plots(
    *,
    mode: str,                     # "analyze" (vision/text → text) or "generate" (text → image)
    prompt_text: str = "",
    model_api_name: str = "gpt-4.1-mini",
    images: list[str] | None = None,
    image_detail: str = "high",    # "low" | "high" | "auto"
    max_tokens: int = 1200,
    use_cache: bool = True,
    cache_dir: str | None = None,
    analysis_key_suffix: str = "plot_analysis",
    section_title: str = "authors",
    overall_topic: str | None = None,   # human-readable cache grouping
    store_only: bool = False,           # parity; noop here
    read: bool = False,                 # parity; noop here

    # --- Function/tool calling ---
    tools: list | None = None,                  # list of tool definitions (function/custom)
    tool_router=None,                           # callable or dict: routes {name, args/input} -> result
    tool_choice: str | dict = "auto",           # "auto" | "required" | {"type":"function","name":"..."} | {"type":"allowed_tools",...}
    allowed_tools: list | None = None,          # OPTIONAL: merged into tool_choice (NOT a top-level param)
    parallel_tool_calls: bool | None = None,    # True/False (some SDKs don’t support; we retry without)
    instructions: str | None = None,            # optional system/instructions string
    max_function_loops: int = 3,                # safety: limit tool-call rounds
) -> dict:
    """
    Analyze images/text → text, or generate images — with optional function/tool calling.

    FIX: 'allowed_tools' is *embedded in tool_choice*, not passed to responses.create().
    """
    import os, json, base64, hashlib, logging
    from pathlib import Path

    # ---------------- cache setup ----------------
    default_root = os.getenv("ANNOTARIUM_CACHE_DIR") or str(Path.home() / ".annotarium_llm_cache")
    cache_dir = cache_dir or default_root
    Path(cache_dir).mkdir(parents=True, exist_ok=True)

    def _sanitize(s: str) -> str:
        import re
        s = (s or "").strip()
        s = re.sub(r"[^A-Za-z0-9_.-]+", "_", s)
        return s.strip("_") or "default"

    topic_tag = _sanitize(overall_topic or section_title or "default")
    func_tag = _sanitize(analysis_key_suffix or "plot_analysis")
    def _canon_json(obj):
        try:
            return json.dumps(obj, sort_keys=True, separators=(",", ":"))
        except Exception:
            return str(obj)
    key_blob = {
        "mode": mode,
        "prompt_text": prompt_text or "",
        "model": model_api_name or "",
        "tools": tools or [],
        "tool_choice": tool_choice if tool_choice is not None else "auto",
        "allowed_tools": allowed_tools or [],
        "parallel_tool_calls": bool(parallel_tool_calls) if parallel_tool_calls is not None else None,
        "max_tokens": int(max_tokens or 0),
        "section_title": section_title or "",
        "overall_topic": overall_topic or "",
        "analysis_key_suffix": analysis_key_suffix or "",
    }
    h_all = hashlib.md5(_canon_json(key_blob).encode("utf-8")).hexdigest()


    cache_name = f"{topic_tag}__{func_tag}__{h_all}.json"
    cache_path = Path(cache_dir) / cache_name
    short_key = h_all

    # ---- EARLY CACHE SHORT-CIRCUIT (stable) ----
    if use_cache and cache_path.exists() and mode in {"analyze", "generate"}:
        try:
            cached = json.loads(cache_path.read_text(encoding="utf-8"))
            if mode == "analyze":
                logging.info(f"{topic_tag.upper()}: CACHE HIT → {cache_path} (key={short_key})")
                return cached
            else:  # generate
                imgs = cached.get("images_base64") if isinstance(cached, dict) else None
                if isinstance(imgs, list) and imgs:
                    logging.info(f"{topic_tag.upper()}: CACHE HIT → {cache_path} (key={short_key})")
                    return cached
            logging.info(f"{topic_tag.upper()}: CACHE MISS (stale/empty) → {cache_path} (key={short_key})")
        except Exception as e:
            logging.warning(f"{topic_tag.upper()}: CACHE READ ERROR ({cache_path}): {e}")
            logging.info(f"{topic_tag.upper()}: CACHE MISS → {cache_path} (key={short_key})")

    # ---------------- helpers ----------------
    def _as_image_url(p: str) -> str | None:
        import mimetypes
        if not isinstance(p, str) or not p.strip():
            return None
        s = p.strip()
        if s.lower().startswith(("http://", "https://", "data:")):
            return s
        try:
            b = Path(s).read_bytes()
            mime, _ = mimetypes.guess_type(s)
            mime = mime or "image/png"
            return f"data:{mime};base64,{base64.b64encode(b).decode('ascii')}"
        except Exception as e:
            logging.warning(f"call_models_plots: failed to read image '{p}': {e}")
            return None

    def _extract_text_from_response(resp) -> str:
        text = ""
        try:
            text = (getattr(resp, "output_text", None) or "").strip()
            if text:
                return text
        except Exception:
            pass
        try:
            out = getattr(resp, "output", None) or []
            parts = []
            for item in out:
                itype = getattr(item, "type", None) or (item.get("type") if isinstance(item, dict) else None)
                if itype == "message":
                    content = getattr(item, "content", None) or (item.get("content") if isinstance(item, dict) else [])
                    for c in content:
                        if isinstance(c, dict) and c.get("type") in {"text", "output_text"}:
                            val = c.get("text") or c.get("output_text") or ""
                            if isinstance(val, str) and val.strip():
                                parts.append(val.strip())
            return "\n".join(parts).strip()
        except Exception:
            return ""

    def _safe_usage(resp):
        usage_obj = getattr(resp, "usage", None)
        try:
            if usage_obj is None:
                return None
            if hasattr(usage_obj, "model_dump"):
                return usage_obj.model_dump()
            if isinstance(usage_obj, dict):
                return usage_obj
            return {
                k: getattr(usage_obj, k) for k in ("input_tokens", "output_tokens", "total_tokens")
                if hasattr(usage_obj, k)
            } or None
        except Exception:
            return None

    def _stringify_output(obj) -> str:
        try:
            if isinstance(obj, (dict, list)):
                return json.dumps(obj, ensure_ascii=False)
            if obj is None:
                return "null"
            return str(obj)
        except Exception:
            return str(obj)

    def _serialize_response(resp):
        """
        Best-effort conversion of the OpenAI SDK response into a JSON-serializable dict.
        Falls back to repr(resp) if needed.
        """
        try:
            if resp is None:
                return None
            if hasattr(resp, "model_dump"):
                return resp.model_dump()
            if hasattr(resp, "to_dict"):
                return resp.to_dict()
            if hasattr(resp, "dict"):
                return resp.dict()
            if hasattr(resp, "to_json"):
                try:
                    return json.loads(resp.to_json())
                except Exception:
                    pass
            if isinstance(resp, (dict, list, str, int, float, bool)):
                return resp
            # generic fallback
            return json.loads(json.dumps(resp, default=lambda o: getattr(o, "__dict__", repr(o))))
        except Exception:
            try:
                return repr(resp)
            except Exception:
                return None

    def _route_tool(name: str, arg_payload):
        if callable(tool_router):
            return tool_router(name, arg_payload)
        if isinstance(tool_router, dict):
            fn = tool_router.get(name)
            if fn is None:
                raise KeyError(f"Unknown tool '{name}'")
            if isinstance(arg_payload, dict):
                return fn(**arg_payload)
            return fn(arg_payload)
        raise RuntimeError("tool_router is not provided (callable or dict)")

    # ---------------- client ----------------
    try:
        from openai import OpenAI
    except Exception:
        return {"text": "", "error": "openai library not installed"}
    client = OpenAI()

    # ---------------- modes ----------------
    if mode == "analyze":
        content = [{"type": "input_text", "text": prompt_text}]
        for p in (images or []):
            url = _as_image_url(p)
            if url:
                content.append({"type": "input_image", "image_url": url, "detail": image_detail})

        # ---- simple one-shot (no tools) ----
        if not tools or tool_router is None:
            req_kwargs = dict(
                model=model_api_name,
                input=[{"role": "user", "content": content}],
                max_output_tokens=max_tokens,
            )
            if instructions:
                req_kwargs["instructions"] = instructions
            resp = client.responses.create(**req_kwargs)

            text = _extract_text_from_response(resp)
            result = {
                "mode": "analyze",
                "text": text or "",
                "raw_response": None,
                "usage": _safe_usage(resp),
                "model_used": model_api_name,
                "cache_path": str(cache_path),
                "cache_key": short_key,
                "tool_calls": [],
                "iterations": 1,
            }
            if use_cache and result["text"] and not tools:
                try:
                    cache_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
                    logging.info(f"{topic_tag.upper()}: CACHE WRITE → {cache_path} (key={short_key})")
                except Exception as e:
                    logging.warning(f"{topic_tag.upper()}: CACHE WRITE ERROR ({cache_path}): {e}")
            return result

        # ---- tool-calling loop ----
        input_list = [{"role": "user", "content": content}]
        all_tool_calls, iterations = [], 0

        # Compose tool_choice properly (embed allowed_tools here)
        tc = None
        if isinstance(tool_choice, dict):
            tc = tool_choice
        elif allowed_tools:
            # Validate allowed_tools entries are minimal dicts with name/type
            _mini = []
            for t in (allowed_tools or []):
                if isinstance(t, dict) and "name" in t and "type" in t:
                    _mini.append({"type": t["type"], "name": t["name"]})
            tc = {"type": "allowed_tools", "mode": "auto", "tools": _mini}
        elif isinstance(tool_choice, str):
            tc = tool_choice  # "auto" | "required" | "none"

        for loop in range(max(1, int(max_function_loops))):
            iterations += 1
            req_kwargs = dict(
                model=model_api_name,
                input=input_list,
                tools=tools,
                max_output_tokens=max_tokens,
            )
            if instructions:
                req_kwargs["instructions"] = instructions
            if tc is not None:
                req_kwargs["tool_choice"] = tc
            if parallel_tool_calls is not None:
                req_kwargs["parallel_tool_calls"] = bool(parallel_tool_calls)

            # Some SDK versions may not accept parallel_tool_calls; retry without if needed
            try:
                resp = client.responses.create(**req_kwargs)
            except TypeError as te:
                if "parallel_tool_calls" in str(te):
                    req_kwargs.pop("parallel_tool_calls", None)
                    resp = client.responses.create(**req_kwargs)
                else:
                    raise

            # Append model outputs back to input for next round
            try:
                model_output = getattr(resp, "output", None) or []
            except Exception:
                model_output = []
            try:
                input_list += model_output
            except Exception:
                pass

            # Collect tool calls
            this_calls = []
            for item in model_output:
                itype = getattr(item, "type", None) or (item.get("type") if isinstance(item, dict) else None)
                if itype == "function_call":
                    name = getattr(item, "name", None) or (item.get("name") if isinstance(item, dict) else None)
                    call_id = getattr(item, "call_id", None) or (item.get("call_id") if isinstance(item, dict) else None)
                    raw_args = getattr(item, "arguments", None) or (item.get("arguments") if isinstance(item, dict) else "{}")
                    try:
                        args = json.loads(raw_args or "{}")
                    except Exception:
                        args = {}
                    this_calls.append(("function_call", name, call_id, args))
                elif itype == "custom_tool_call":
                    name = getattr(item, "name", None) or (item.get("name") if isinstance(item, dict) else None)
                    call_id = getattr(item, "call_id", None) or (item.get("call_id") if isinstance(item, dict) else None)
                    inp = getattr(item, "input", None) or (item.get("input") if isinstance(item, dict) else "")
                    this_calls.append(("custom_tool_call", name, call_id, inp))

            if not this_calls:
                final_text = _extract_text_from_response(resp)
                result = {
                    "mode": "analyze",
                    "text": final_text or "",
                    "raw_response": _serialize_response(resp),  # <-- include full raw response
                    "usage": _safe_usage(resp),
                    "model_used": model_api_name,
                    "cache_path": str(cache_path),
                    "cache_key": short_key,
                    "tool_calls": all_tool_calls,
                    "iterations": iterations,
                    "error": "no_tool_calls_from_model",  # <-- explicit error marker
                }
                try:
                    Path(cache_path).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
                except Exception:
                    pass
                return result

            # Execute tools and append outputs
            for kind, name, call_id, payload in this_calls:
                try:
                    out = _route_tool(name, payload)
                    out_str = _stringify_output(out)
                except Exception as e:
                    out_str = _stringify_output({"error": f"{type(e).__name__}: {e}"})

                input_list.append({
                    "type": "function_call_output" if kind == "function_call" else "custom_tool_result",
                    "call_id": call_id,
                    "output": out_str,
                })
                all_tool_calls.append({
                    "type": kind,
                    "name": name,
                    "call_id": call_id,
                    "arguments" if kind == "function_call" else "input": payload,
                    "output": out_str,
                })

        # loop cap reached
        text_fallback = _extract_text_from_response(resp) if 'resp' in locals() else ""
        return {
            "mode": "analyze",
            "text": text_fallback or "",
            "raw_response": _serialize_response(resp) if 'resp' in locals() else None,  # <-- include full raw response
            "usage": _safe_usage(resp) if 'resp' in locals() else None,
            "model_used": model_api_name,
            "cache_path": str(cache_path),
            "cache_key": short_key,
            "tool_calls": all_tool_calls,
            "iterations": iterations,
            "warning": "max_function_loops reached; response may be partial",
            "error": "max_function_loops_reached",  # <-- explicit error marker
        }


    elif mode == "generate":
        resp = client.responses.create(
            model=model_api_name,
            input=prompt_text,
            tools=[{"type": "image_generation"}],
        )
        base64_blocks = []
        try:
            for out in getattr(resp, "output", []):
                if getattr(out, "type", "") == "image_generation_call":
                    base64_blocks.append(out.result)
                elif isinstance(out, dict) and out.get("type") == "image_generation_call":
                    base64_blocks.append(out.get("result"))
        except Exception:
            pass

        result = {
            "mode": "generate",
            "images_base64": [b for b in base64_blocks if b],
            "model_used": model_api_name,
            "cache_path": str(cache_path),
            "cache_key": short_key,
        }
        if use_cache and result["images_base64"]:
            try:
                cache_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
                logging.info(f"{topic_tag.upper()}: CACHE WRITE → {cache_path} (key={short_key})")
            except Exception as e:
                logging.warning(f"{topic_tag.upper()}: CACHE WRITE ERROR ({cache_path}): {e}")
        return result

    else:
        return {"text": "", "error": f"unknown mode: {mode}"}



def call_models(ai_provider_key: str,
                model_api_name: str,
                *,
                prompt_text: str,
                analysis_key_suffix: str,

                max_tokens: int = 10000,
                vision: bool = False,
                use_cache: bool = True,
                dynamic_image_path: str | None = None,
                base_output_dir_for_logs: str | None = None,
                json_schema: dict | str | None = None,
                store_only: bool = False,
                read: bool = False,
                section_title: str | None = None,
                custom_id: str | None = None,
                by_index: int | None = None,
                effort: str = "low",
                results_so_far: dict | None = None,
                overall_topic: str | None = None,
                ):
    """
    Unified wrapper around the OpenAI Responses API with three modes:
      - LIVE        : direct client.responses.create
      - STORE-ONLY  : append a JSONL request line for OpenAI Batches
      - READ        : parse a JSONL '..._output.jsonl' file (OpenAI Batches result)

    File layout (unless BATCH_ROOT is set):
      <base>/batches/<function>/<collection>_{input|output}.jsonl
      where:
        function   := sanitized(analysis_key_suffix)
        collection := sanitized(section_title or 'default')

    Returns a dict with common keys:
      raw_text, model_used, error, provider, prompt_sent, (and batch details in batch modes)
    """
    import os, json, time, base64, mimetypes, hashlib, logging, traceback
    from datetime import datetime
    from pathlib import Path

    # -----------------------------
    # Helpers
    # -----------------------------

    def _sanitize(s: str, default: str = "task") -> str:
        import re
        s = (s or default).strip()
        s = re.sub(r'[^A-Za-z0-9_.-]+', '_', s)
        return s.strip('_') or default

    def _extract_text_from_responses(resp_obj) -> str:
        """
        Best effort text extraction from Responses object.
        Returns the concatenated string EXACTLY as produced by the model,
        so HTML (e.g., <p>…</p>) is preserved verbatim.
        """
        # Fast path
        try:
            if hasattr(resp_obj, "output_text") and resp_obj.output_text:
                return resp_obj.output_text
        except Exception:
            pass

        chunks = []
        try:
            output = getattr(resp_obj, "output", None)
            if not output:
                return ""
            for item in output:
                if getattr(item, "type", None) == "message":
                    parts = getattr(item, "content", []) or []
                    for part in parts:
                        t = getattr(part, "type", None)
                        if t in ("output_text", "text"):
                            txt = getattr(part, "text", "")
                            if isinstance(txt, str) and txt:
                                chunks.append(txt)
        except Exception:
            # fallthrough to join whatever we have
            pass

        return "\n".join(chunks)

    def _extract_text_from_serialized(body: dict) -> str:
        """
        Extract plain text from a serialized Responses API body (dict), as written by Batch output.
        Supports both {'type': 'output_text'} and {'type': 'text'} shapes.
        """
        try:
            if isinstance(body, dict) and isinstance(body.get("output_text"), str):
                return body["output_text"]

            out = []
            for item in (body or {}).get("output", []):
                if not isinstance(item, dict):
                    continue
                if item.get("type") == "message":
                    for part in item.get("content", []):
                        if isinstance(part, dict) and part.get("type") in ("output_text", "text"):
                            if part.get("text"):
                                out.append(part["text"])
            if out:
                return "\n".join(out)
        except Exception:
            pass
        return ""

    def _extract_function_args_from_serialized(body: dict, schema_props: dict | None) -> str | None:
        """
        Extract function-call arguments string from a serialized Responses API body (dict).
        """
        try:
            for item in (body or {}).get("output", []):
                if not isinstance(item, dict):
                    continue
                if item.get("type") == "tool_call":
                    fn = item.get("function") or {}
                    args = fn.get("arguments")
                    if isinstance(args, str):
                        return args

            # Heuristic: sometimes the model emits JSON as plain text message
            if schema_props:
                txt = _extract_text_from_serialized(body)
                if txt:
                    try:
                        maybe = json.loads(txt)
                        if isinstance(maybe, dict):
                            keys = set(schema_props.keys())
                            if keys and keys.issubset(set(maybe.keys())):
                                return txt
                    except Exception:
                        pass
        except Exception:
            pass
        return None

    # -----------------------------
    env_store = os.getenv("BATCH_MODE_STORE_ONLY", "0") == "1"
    env_read = os.getenv("BATCH_MODE_READ", "0") == "1"

    # Effective toggles
    eff_store_only = bool(store_only or env_store)
    eff_read = bool(read or env_read)
    # In batch modes (store_only or read), force cache off so we don't short-circuit the workflow
    if store_only or read or eff_store_only or eff_read:
        if use_cache:
            import logging as _logging
            _logging.info(
                f"CACHE DISABLED because batch mode is active "
                f"(store_only={store_only or eff_store_only}, read={read or eff_read})."
            )
        use_cache = False

    # use_cache=True

    # -----------------------------
    # Batch root & files (PROJECT-ANCHORED)
    # -----------------------------
    # Anchor under the repo root (…\annotarium_package (1)\annotarium_package) so
    # outputs land where you expect, NOT in AppData.
    try:
        _repo_root = Path(__file__).resolve().parents[3]  # …\annotarium_package (1)\annotarium_package
    except Exception:
        _repo_root = Path.cwd()

    # Use your helper; it will ignore AppData because we pass override_root
    root = get_batch_root()  # …/Batching_files
    func_dir = root / analysis_key_suffix  # …/Batching_files/<function>
    func_dir.mkdir(parents=True, exist_ok=True)


    input_file = func_dir / f"{section_title}_{analysis_key_suffix}_input.jsonl"
    output_file = func_dir / f"{section_title}_{analysis_key_suffix}_output.jsonl"

    # Resolve a stable cache directory, independent of CWD.
    # Priority: ANNOTARIUM_CACHE_DIR → <logs>/llm_cache → <repo>/.annotarium_llm_cache → ~ → CWD
    cache_dir_candidates = []
    env_cache_dir = os.getenv("ANNOTARIUM_CACHE_DIR")
    if env_cache_dir:
        cache_dir_candidates.append(Path(env_cache_dir))
    if base_output_dir_for_logs:
        cache_dir_candidates.append(Path(base_output_dir_for_logs) / "llm_cache")
    try:
        repo_root_guess = Path(__file__).resolve().parents[3]
        cache_dir_candidates.append(repo_root_guess / ".annotarium_llm_cache")
    except Exception:
        pass
    cache_dir_candidates.append(Path.home() / ".annotarium_llm_cache")
    cache_dir_candidates.append(Path.cwd() / ".annotarium_llm_cache")

    cache_dir = None
    for _cand in cache_dir_candidates:
        try:
            _cand.mkdir(parents=True, exist_ok=True)
            cache_dir = _cand
            break
        except Exception:
            continue
    if cache_dir is None:
        cache_dir = Path.cwd() / ".annotarium_llm_cache"
    # logging.info(f"CACHE DIR: {cache_dir}")

    # derive a short dataset/topic tag for cache isolation and readability
    def _dataset_tag(rsf: dict | None) -> str:
        import re
        # Prefer an explicit overall_topic if provided; fall back to prior heuristics
        topic = (
                (overall_topic or "").strip()
                or (rsf or {}).get(STEP_LOAD_DATA, {}).get("collection_name_for_title")
                or (rsf or {}).get("research_topic")
                or os.getenv("BATCH_FUNCTION")
                or "dataset"
        )
        tag = re.sub(r"[^A-Za-z0-9_.-]+", "_", str(topic))[:64].strip("_")
        return tag or "dataset"

    dataset_tag = _dataset_tag(results_so_far)

    # Build cache identity INCLUDING dataset/topic + function name
    cache_key_parts = {
        "provider": ai_provider_key,
        "model": model_api_name or "default_model",
        "prompt": prompt_text,
        "max_t": max_tokens,
        "vision": vision,
        "image_path": str(dynamic_image_path) if (vision and dynamic_image_path) else None,
        "schema": json.dumps(json_schema, sort_keys=True) if json_schema else None,
        "effort": effort,
        "analysis_key_suffix": analysis_key_suffix,
        "section_title": section_title,
        "dataset_tag": dataset_tag,
        "overall_topic": overall_topic,
    }
    cache_identifier_string = json.dumps(cache_key_parts, sort_keys=True)
    cache_filename_hash = hashlib.md5(cache_identifier_string.encode('utf-8')).hexdigest()

    # Make the filename human-friendly while still unique
    cache_file_path = (
            cache_dir / f"{dataset_tag}__{analysis_key_suffix}__{cache_filename_hash}.json") if use_cache else None
    # fallback custom_id if none was provided (also dataset-aware)
    if not custom_id:
        pid = hashlib.md5((prompt_text or "").encode("utf-8")).hexdigest()[:10]
        suffix = f"idx{by_index}" if by_index is not None else "idx0"
        topic_bits = (overall_topic or dataset_tag or "topic")[:32].replace(" ", "_")
        section_bits = (section_title or "section")[:32].replace(" ", "_")
        custom_id = f"{topic_bits}:{section_bits}:{analysis_key_suffix}:{pid}:{suffix}"
    if eff_store_only:
        # Only auto-switch to READ if the current custom_id ALREADY exists in the output file.
        try:
            meta_path = func_dir / f"{section_title}_{analysis_key_suffix}_batch_metadata.json"
            if meta_path.exists() and output_file.exists() and output_file.stat().st_size > 0 and custom_id:
                with open(output_file, "r", encoding="utf-8") as _of:
                    found = any(
                        (json.loads(line.strip()).get("custom_id") == custom_id)
                        for line in _of if line.strip()
                    )
                if found:
                    logging.info(f"[BATCH store-only] Found matching custom_id in output; switching to READ.")
                    eff_store_only = False
                    eff_read = True
        except Exception as _e_probe:
            logging.warning(
                f"[BATCH store-only] Output probe failed; staying in STORE mode. Details: {_e_probe!r}")
    if output_file.exists():
        eff_store_only=False
        eff_read=True
    # -----------------------------
    # READ mode (parse batches output file)
    # -----------------------------
    if eff_read:
        # Parse the whole batch file...
        if not output_file.exists() or output_file.stat().st_size == 0:
            return {
                "raw_text": "",
                "model_used": model_api_name,
                "error": f"Batch output not found or empty: {output_file}",
                "provider": ai_provider_key,
                "prompt_sent": prompt_text,
                "batch_results": [],
                "batch_cost_summary": {
                    "input_tokens": 0, "output_tokens": 0, "total_tokens": 0, "cost_usd": 0.0,
                    "model": model_api_name, "is_batch": True
                }
            }

        total_in = 0
        total_out = 0
        results = []
        selected_text = None
        selected_usage = None

        with open(output_file, "r", encoding="utf-8") as f:
            for line_idx, line in enumerate(f):
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except Exception:
                    continue

                body = (obj.get("response") or {}).get("body", {})
                usage = body.get("usage", {}) if isinstance(body, dict) else {}
                in_tok = usage.get("input_tokens") or usage.get("prompt_tokens", 0) or 0
                out_tok = usage.get("output_tokens") or usage.get("completion_tokens", 0) or 0
                total_in += int(in_tok)
                total_out += int(out_tok)

                # match by index or custom_id
                is_match = False
                if by_index is not None:
                    is_match = (line_idx == by_index)
                elif custom_id:
                    is_match = (obj.get("custom_id") == custom_id)

                if is_match:
                    try:
                        if isinstance(json_schema, dict):
                            schema_props = json_schema.get("properties",
                                                           json_schema.get("parameters", {}).get("properties",
                                                                                                 {})) or {}
                            txt = _extract_function_args_from_serialized(body, schema_props) \
                                  or _extract_text_from_serialized(body)
                        else:
                            txt = _extract_text_from_serialized(body)
                    except Exception:
                        txt = ""
                    selected_text = (txt or "").strip()
                    selected_usage = {
                        "input_tokens": int(in_tok),
                        "output_tokens": int(out_tok),
                        "total_tokens": int(in_tok) + int(out_tok),
                        "cost_usd": _estimate_cost_usd(in_tok, out_tok, model_api_name, is_batch=True),
                        "model": model_api_name,
                        "is_batch": True,
                    }

                results.append({
                    "custom_id": obj.get("custom_id"),
                    "has_error": bool(obj.get("error")),
                })

        batch_summary = {
            "input_tokens": total_in,
            "output_tokens": total_out,
            "total_tokens": total_in + total_out,
            "cost_usd": _estimate_cost_usd(total_in, total_out, model_api_name, is_batch=True),
            "model": model_api_name,
            "is_batch": True,
        }

        # ✅ Return on success
        if selected_text is not None:
            return {
                "raw_text": selected_text,
                "model_used": model_api_name,
                "error": None,
                "provider": ai_provider_key,
                "prompt_sent": prompt_text,
                "usage": selected_usage or {
                    "input_tokens": 0, "output_tokens": 0, "total_tokens": 0,
                    "cost_usd": 0.0, "model": model_api_name, "is_batch": True
                },
                "batch_results": results,
                "batch_cost_summary": batch_summary,
            }

        # Otherwise, explicit error return
        return {
            "raw_text": "",
            "model_used": model_api_name,
            "error": f"custom_id not found in batch output: {custom_id}",
            "provider": ai_provider_key,
            "prompt_sent": prompt_text,
            "batch_results": results,
            "usage": {
                "input_tokens": 0, "output_tokens": 0, "total_tokens": 0,
                "cost_usd": 0.0, "model": model_api_name, "is_batch": True
            },
            "batch_cost_summary": batch_summary,
        }

    # -----------------------------
    # STORE-ONLY mode (append a JSONL line for batches)
    # -----------------------------

    if eff_store_only:
        # Build a single batch request line using your helpers.
        # System content: brief task context for the batch request.
        system_content = f"You are assisting with: {analysis_key_suffix or 'task'}."
        schema_wrapper = json_schema if isinstance(json_schema, dict) else None
        safe_custom_id = custom_id or f"{_sanitize(analysis_key_suffix)}:{_sanitize(section_title or 'section')}:{int(time.time() * 1000)}"

        try:
            batch_request = prepare_batch_requests(
                text_to_send=prompt_text,
                custom_id=safe_custom_id,
                content=system_content,
                schema_wrapper=schema_wrapper,
                model=(model_api_name or "gpt-5-mini"),
            )
        except Exception as e_prep:
            return {
                "raw_text": "",
                "model_used": model_api_name,
                "error": f"Failed to build batch request: {e_prep}",
                "provider": ai_provider_key,
                "prompt_sent": prompt_text,
            }

        try:
            write_batch_requests_to_file(batch_request=batch_request, file_name=str(input_file))
            logging.info(f"[BATCH store-only] Appended request to {input_file}")
        except Exception as e_w:
            return {
                "raw_text": "",
                "model_used": model_api_name,
                "error": f"Failed to write batch request: {e_w}",
                "provider": ai_provider_key,
                "prompt_sent": prompt_text,
                "batch": {
                    "mode": "store_only",
                    "input_path": str(input_file),
                    "output_path": str(output_file),
                    "custom_id": safe_custom_id
                }
            }

        return {
            "raw_text": "",
            "model_used": model_api_name,
            "error": None,
            "provider": ai_provider_key,
            "prompt_sent": prompt_text,
            "batch": {
                "mode": "store_only",
                "input_path": str(input_file),
                "output_path": str(output_file),
                "custom_id": safe_custom_id
            }
        }

    # -----------------------------
    # LIVE mode (Responses API)
    # -----------------------------
    # Cache short-circuit
    effective_cache_path = cache_file_path if (use_cache and cache_file_path) else None

    if use_cache and (not effective_cache_path or not effective_cache_path.exists()):
        # Probe for the latest file with the same dataset/analysis prefix and matching prompt
        try:
            pattern = f"{dataset_tag}__{analysis_key_suffix}__*.json"
            candidates = sorted(
                cache_dir.glob(pattern),
                key=lambda p: p.stat().st_mtime,
                reverse=True,
            )
        except Exception:
            candidates = []

        for _p in candidates:
            try:
                with open(_p, "r", encoding="utf-8") as fh:
                    _obj = json.load(fh) or {}
                # If schema is expected, only accept cache entries whose raw_text parses as JSON
                if isinstance(json_schema, dict):
                    _rt = _obj.get("raw_text", "")
                    try:
                        json.loads(_rt)
                    except Exception:
                        continue
                # Only consider a hit if the prompt matches exactly
                if _obj.get("prompt_sent") == prompt_text:
                    effective_cache_path = _p
                    logging.info(f"CACHE PROBE HIT: using {effective_cache_path}")
                    break
            except Exception:
                continue

    if use_cache and effective_cache_path and effective_cache_path.exists():
        try:
            with open(effective_cache_path, "r", encoding="utf-8") as f_cache:
                cached = json.load(f_cache)

            cached_text = (cached or {}).get("raw_text", "")
            cached_err = (cached or {}).get("error")

            if cached_err:
                logging.info(
                    f"CACHE PRESENT but contains error for '{analysis_key_suffix}' "
                    f"(provider={ai_provider_key}, model={model_api_name}). Will call OpenAI API."
                )
            else:
                if isinstance(json_schema, dict):
                    try:
                        json.loads(cached_text)
                        logging.info(
                            f"CACHE HIT for '{analysis_key_suffix}' "
                            f"(provider={ai_provider_key}, model={model_api_name}). "
                            f"Using cached response from {effective_cache_path}. Skipping OpenAI API call."
                        )
                        cached["from_cache"] = True
                        return cached
                    except Exception:
                        logging.info(
                            f"CACHE HIT but cached raw_text is not valid JSON for '{analysis_key_suffix}'. "
                            f"Ignoring cache and calling OpenAI API."
                        )
                else:
                    logging.info(
                        f"CACHE HIT for '{analysis_key_suffix}' "
                        f"(provider={ai_provider_key}, model={model_api_name}). "
                        f"Using cached response from {effective_cache_path}. Skipping OpenAI API call."
                    )
                    cached["from_cache"] = True
                    return cached

        except Exception as e_load_cache:
            logging.warning(
                f"Cache load failed for '{analysis_key_suffix}' from {effective_cache_path}: {e_load_cache}. "
                f"Proceeding to live OpenAI call."
            )

    # Explicit cache miss/disabled logs before making a live call
    if not use_cache:
        logging.info(f"CACHE DISABLED for '{analysis_key_suffix}'. Will call OpenAI API.")
    elif not cache_file_path:
        logging.info(f"CACHE MISS for '{analysis_key_suffix}': cache_file_path is None. Will call OpenAI API.")
    elif not (effective_cache_path and effective_cache_path.exists()):
        logging.info(
            f"CACHE MISS for '{analysis_key_suffix}': {cache_file_path} not found (after probe). Will call OpenAI API.")
    if not OPENAI_CLIENT_AVAILABLE:
        return {
            "raw_text": "Error: OpenAI library not installed.",
            "model_used": model_api_name,
            "error": "OpenAI library missing.",
            "provider": ai_provider_key,
            "prompt_sent": prompt_text
        }

    api_key = os.getenv(f"{ai_provider_key.upper()}_API_KEY", os.getenv("OPENAI_API_KEY"))
    base_url = os.getenv(f"{ai_provider_key.upper()}_BASE_URL", os.getenv("OPENAI_BASE_URL"))
    if not api_key:
        err_msg = f"API key for '{ai_provider_key}' not found. Set {ai_provider_key.upper()}_API_KEY or OPENAI_API_KEY."
        return {
            "raw_text": err_msg,
            "model_used": model_api_name,
            "error": "API Key missing.",
            "provider": ai_provider_key,
            "prompt_sent": prompt_text
        }

    client_params = {"api_key": api_key}
    if base_url:
        client_params["base_url"] = base_url
    logging.info(
        f"AI Endpoint (responses.create): {client_params.get('base_url', 'Default OpenAI')} ({ai_provider_key})")
    logging.debug("call_models: ready to call responses.create (post-cache).")


    client = openai.OpenAI(**client_params)
    model_id = model_api_name or "gpt-5-mini"

    # Build input
    processed_image_for_payload = False
    user_content_blocks = []
    if prompt_text:
        user_content_blocks.append({"type": "input_text", "text": prompt_text})
    if vision and dynamic_image_path and Path(dynamic_image_path).is_file():
        try:
            mime_type, _ = mimetypes.guess_type(dynamic_image_path)
            with open(dynamic_image_path, "rb") as image_file:
                base64_image = base64.b64encode(image_file.read()).decode("utf-8")
            image_url_for_api = f"data:{mime_type or 'image/png'};base64,{base64_image}"
            user_content_blocks.append({"type": "input_image", "image_url": image_url_for_api})
            processed_image_for_payload = True
        except Exception as e_img:
            logging.error(f"Error processing image {dynamic_image_path}: {e_img}")

    if user_content_blocks:
        final_input_param = [{"role": "user", "content": user_content_blocks}]
    else:
        final_input_param = prompt_text or ""

    logging.info(
        f"OPENAI API CALL (live): provider={ai_provider_key}, model={model_id}, "
        f"task={analysis_key_suffix}, max_output_tokens={max_tokens}, "
        f"vision={processed_image_for_payload}"
    )

    tools_block = None
    tool_choice_block = None
    if isinstance(json_schema, str):
        tools_block = [{"type": json_schema, "name": f"{json_schema}_tool"}]
        tool_choice_block = {"type": json_schema, "name": f"{json_schema}_tool"}
    elif isinstance(json_schema, dict):
        tool_name = f"{_sanitize(analysis_key_suffix)[:28]}_func"
        tools_block = [{
            "type": "function",
            "name": tool_name,
            "description": json_schema.get("description", "Structured output tool."),
            "parameters": json_schema.get("parameters", json_schema)
        }]
        tool_choice_block = {"type": "function", "name": tool_name}

    call_kwargs: dict = {
        "model": model_id,
        "input": final_input_param,
        "max_output_tokens": max_tokens,
    }
    if effort:
        call_kwargs["reasoning"] = {"effort": effort}

    if tools_block:
        call_kwargs["tools"] = tools_block
        if tool_choice_block:
            call_kwargs["tool_choice"] = tool_choice_block
    else:
        call_kwargs["tool_choice"] = "none"

    # Light retry
    response_obj = None
    raw_out = ""
    for attempt in range(2):
        logging.debug(
            f"OPENAI responses.create attempt {attempt + 1}/2 for '{analysis_key_suffix}' "
            f"(vision={processed_image_for_payload}, schema={'yes' if isinstance(json_schema, dict) else 'no'})"
        )
        response_obj = client.responses.create(**call_kwargs)
        print("response object inside attempt in range(2)")
        print(response_obj)
        try:
            # If a JSON schema is provided, prefer structured arguments; otherwise treat output as free-form text/HTML.
            if isinstance(json_schema, dict):
                schema_props = json_schema.get("properties",
                                               json_schema.get("parameters", {}).get("properties", {})) or {}
                raw_out = (
                        _extract_function_args_from_serialized(response_obj.model_dump(), schema_props)
                        or _extract_text_from_responses(response_obj)
                        or ""
                ).strip()
            else:
                # HTML-safe: do not validate/transform; return exactly what the model produced (includes <p>…</p>, etc.).
                raw_out = (_extract_text_from_responses(response_obj) or "").strip()

            if raw_out:
                break

            if attempt == 0:
                # second attempt: force text-only input (no multi-part blocks)
                call_kwargs["input"] = prompt_text
                continue

        except openai.APIError as e:
            logging.error(f"API Error (responses.create) for '{analysis_key_suffix}' (Attempt {attempt + 1}): {e}")
            if attempt == 1:
                pass
            else:
                time.sleep(1 + 2 * attempt)
        except Exception as e:
            logging.error(
                f"General Error (responses.create) for '{analysis_key_suffix}' (Attempt {attempt + 1}): {e}\n{traceback.format_exc()}")
            if attempt == 1:
                pass
            else:
                time.sleep(1 + 2 * attempt)

    # Third attempt: schema-free JSON fallback (if schema expected but we got nothing)
    if not raw_out and isinstance(json_schema, dict):

        try:
            json_only_prompt = (
                                       prompt_text or "").rstrip() + "\n\nReturn a single JSON object only. No prose outside JSON."
            fallback_kwargs = {
                "model": model_id,
                "input": json_only_prompt,
                "max_output_tokens": max_tokens,
                "tool_choice": "none"
            }
            if effort:
                fallback_kwargs["reasoning"] = {"effort": "low"}
            response_obj = client.responses.create(**fallback_kwargs)

            raw_out = (_extract_text_from_responses(response_obj) or "").strip()

            # Validate JSON; if truncated or invalid, regenerate the FULL object from scratch (still schema-free)
            needs_regen = False
            try:
                json.loads(raw_out)
            except Exception:
                needs_regen = True

            if needs_regen:
                regen_prompt = (
                                       prompt_text or "").rstrip() + "\n\nReprint the COMPLETE JSON object from the beginning. Output JSON only (no comments, no prose)."
                regen_kwargs = {
                    "model": model_id,
                    "input": regen_prompt,
                    # "max_output_tokens": max_tokens,
                    "tool_choice": "none"
                }
                if effort:
                    regen_kwargs["reasoning"] = {"effort": "low"}
                response_obj = client.responses.create(**regen_kwargs)
                raw_out = (_extract_text_from_responses(response_obj) or "").strip()

                # One more quick validation; if still invalid, let the outer handler show a precise error
                try:
                    json.loads(raw_out)
                except Exception as _:
                    pass

        except Exception as e_fb:
            logging.error(f"Schema-free JSON fallback failed for '{analysis_key_suffix}': {e_fb}")

    if not response_obj:
        return {
            "raw_text": "AI call failed after retries (responses.create).",
            "model_used": model_id,
            "error": "Max retries exceeded.",
            "provider": ai_provider_key,
            "prompt_sent": prompt_text,
            "input_payload_sent": call_kwargs.get("input")
        }

    if not raw_out:
        if not raw_out:
            msg = ("Empty model output after retries "
                   + ("(with JSON fallback tried)." if isinstance(json_schema,
                                                                  dict) else "(no JSON fallback applicable)."))
            return {
                "raw_text": "",
                "model_used": getattr(response_obj, "model", model_id),
                "error": msg,
                "provider": ai_provider_key,
                "prompt_sent": prompt_text,
                "input_payload_sent": call_kwargs.get("input")
            }

        # If a schema was expected, ensure we’re returning valid JSON; otherwise downstream parsers will fail noisily.
    if isinstance(json_schema, dict):
        try:
            json.loads(raw_out)
        except Exception as _e_json_final:
            return {
                "raw_text": raw_out,
                "model_used": getattr(response_obj, "model", model_id),
                "error": f"Model returned non-parseable JSON after fallback: {_e_json_final}",
                "provider": ai_provider_key,
                "prompt_sent": prompt_text,
                "input_payload_sent": call_kwargs.get("input")
            }
    model_echo = getattr(response_obj, "model", model_id)
    tokens_info = getattr(response_obj, "usage", None)
    total_tokens = getattr(tokens_info, "total_tokens", "N/A") if tokens_info else "N/A"
    logging.info(
        f"AI response received for '{analysis_key_suffix}'. Model: {model_echo}, Tokens: {total_tokens}, Output length: {len(raw_out)}")

    # Persist logs (optional)
    if base_output_dir_for_logs:
        log_dir = Path(base_output_dir_for_logs) / "api_logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d%H%M%S%f")[:-3]
        log_fn = f"{_sanitize(analysis_key_suffix)}_{ts}_responses_create.log"
        with open(log_dir / log_fn, "w", encoding="utf-8") as fh:
            try:
                input_dump = final_input_param if isinstance(final_input_param, str) else json.dumps(
                    final_input_param, indent=2)
            except TypeError:
                input_dump = str(final_input_param)
            response_dump = "Could not dump response object."
            if hasattr(response_obj, "model_dump_json"):
                try:
                    response_dump = response_obj.model_dump_json(indent=2)
                except Exception:
                    pass
            fh.write(
                f"INPUT_PAYLOAD:\n{input_dump}\n\nRAW_OUTPUT_EXTRACTED:\n{raw_out}\n\nFULL_RESPONSE_OBJECT:\n{response_dump}")

    # extract token usage where available
    usage_input = 0
    usage_output = 0
    try:
        dump = response_obj.model_dump() if hasattr(response_obj, "model_dump") else {}
        usage_block = dump.get("usage", {})
        usage_input = int(usage_block.get("input_tokens") or 0)
        usage_output = int(usage_block.get("output_tokens") or 0)
    except Exception:
        pass

    api_call_result_package = {
        "raw_text": raw_out if isinstance(raw_out, str) else json.dumps(raw_out, ensure_ascii=False),
        "model_used": model_echo,
        "error": None,
        "provider": ai_provider_key,
        "prompt_sent": prompt_text,
        "input_payload_sent": final_input_param,
        "ai_response_object": (response_obj.model_dump() if hasattr(response_obj, "model_dump") else None),

        # NEW: usage + cost
        "usage": {
            "input_tokens": usage_input,
            "output_tokens": usage_output,
            "total_tokens": usage_input + usage_output,
            "is_batch": False,
        },
        "cost_usd": _estimate_cost_usd(usage_input, usage_output, model_echo, is_batch=False),
    }

    usage = api_call_result_package.get("usage", {})
    from datetime import datetime, timezone

    usage = usage or {}
    cost_usd = float((api_call_result_package or {}).get("cost_usd", 0.0))

    # RFC3339/ISO 8601 Zulu, seconds precision, tz-aware
    ts_utc = datetime.now(timezone.utc).isoformat(timespec="seconds")
    if ts_utc.endswith("+00:00"):
        ts_utc = ts_utc[:-6] + "Z"

    monitor_row = {
        "ts": ts_utc,
        "provider": ai_provider_key,
        "model": usage.get("model", model_echo),
        "section": section_title or analysis_key_suffix,
        "overall_topic": overall_topic,  # NEW: surface in monitor
        "custom_id": custom_id or "",
        "store_only": bool(store_only),
        "read": bool(read),
        "cache": bool(use_cache),
        "from_cache": bool((api_call_result_package or {}).get("from_cache", False)),
        "input_tokens": int(usage.get("input_tokens", 0) or 0),
        "output_tokens": int(usage.get("output_tokens", 0) or 0),
        "total_tokens": int(usage.get("total_tokens", 0) or 0),
        "cost_usd": cost_usd,
        "is_batch": bool(usage.get("is_batch", False)),
        "latency_ms": int((api_call_result_package or {}).get("latency_ms", 0) or 0),
    }

    if results_so_far is not None and not monitor_row["is_batch"]:
        rows = results_so_far.setdefault("_api_monitor_rows", [])
        rows.append(monitor_row)

    # Cache — write successful results to disk
    if use_cache and cache_file_path and not api_call_result_package.get("error"):
        try:
            # If a schema was expected, only cache if raw_text parses as JSON
            ok_to_cache = True
            if isinstance(json_schema, dict):
                try:
                    json.loads(api_call_result_package.get("raw_text", ""))
                except Exception:
                    ok_to_cache = False
                    logging.info(
                        f"CACHE WRITE SKIPPED for '{analysis_key_suffix}': raw_text is not valid JSON."
                    )

            if ok_to_cache:
                cacheable = api_call_result_package.copy()
                # Ensure ai_response_object is JSON-serializable
                aro = cacheable.get("ai_response_object")
                if aro is not None and not isinstance(aro, (dict, list, str, int, float, bool, type(None))):
                    try:
                        if hasattr(response_obj, "model_dump"):
                            cacheable["ai_response_object"] = response_obj.model_dump()
                        else:
                            cacheable["ai_response_object"] = str(aro)
                    except Exception:
                        cacheable["ai_response_object"] = "<complex_object_not_cached>"

                cache_file_path.parent.mkdir(parents=True, exist_ok=True)
                with open(cache_file_path, "w", encoding="utf-8") as f_cache:
                    json.dump(cacheable, f_cache, indent=2)
                logging.info(
                    f"CACHE WRITE: Saved response for '{analysis_key_suffix}' to {cache_file_path}"
                )
        except Exception as e_save_cache:
            logging.warning(f"Cache save failed for '{analysis_key_suffix}': {e_save_cache}")

    return api_call_result_package



STEP__TIMELINE = "timeline"
TIMELINE_SECTION_KEY = STEP__TIMELINE
TIMELINE_SECTION_TITLE = STEP__TIMELINE


def _slugify_ascii(s: str) -> str:
    import re, unicodedata
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode("ascii")
    s = re.sub(r"[^A-Za-z0-9]+", "_", s).strip("_").lower()
    return s or "page"


def _canon_page_slug(section_key: str, subsection: str, page: str) -> str:
    """
    Build a unique slug *per section* so pages never collide even if titles are reused.
    Ex: STEP__TIMELINE, 'Model calls', 'models' -> STEP__TIMELINE_model_calls_models
    """
    return "_".join([_slugify_ascii(section_key), _slugify_ascii(subsection), _slugify_ascii(page)])


# ───────────────────── single source of truth: _ui_html ──────────────────


# ─────────────────────────────────────────────────────────────────────────
# Pricing helpers (per-1k tokens). You can override via env variables.
# Defaults are conservative placeholders so costs are at least visible.
# ─────────────────────────────────────────────────────────────────────────
BATCH_PRICE_DISCOUNT = 0.5  # batch runs cost 50% of live

_DEFAULT_INPUT_PER_1K = float(os.getenv("OPENAI_PRICE_IN_PER_1K", "0.003"))
_DEFAULT_OUTPUT_PER_1K = float(os.getenv("OPENAI_PRICE_OUT_PER_1K", "0.009"))

# Optional model-specific overrides (extend as you wish)
_MODEL_PRICING = {
    # "o4-mini": {"in": 0.00X, "out": 0.00Y},
}


def _pricing_for_model(model_name: str) -> tuple[float, float]:
    """
    Returns (input_per_1k, output_per_1k) for model_name or defaults.
    """
    m = (model_name or "").strip()
    if m in _MODEL_PRICING:
        p = _MODEL_PRICING[m]
        return float(p.get("in", _DEFAULT_INPUT_PER_1K)), float(p.get("out", _DEFAULT_OUTPUT_PER_1K))
    return _DEFAULT_INPUT_PER_1K, _DEFAULT_OUTPUT_PER_1K


def _estimate_cost_usd(input_tokens: int | float,
                       output_tokens: int | float,
                       model_name: str,
                       is_batch: bool) -> float:
    pin, pout = _pricing_for_model(model_name)
    cost = (float(input_tokens) / 1000.0) * pin + (float(output_tokens) / 1000.0) * pout
    if is_batch:
        cost *= BATCH_PRICE_DISCOUNT
    # round just for display stability; keep full precision in dict if you want
    return round(cost, 6)


def get_ai_response_text(response_dict, default_title="AI Analysis"):
    import logging, html, json

    # NEW: guard against wrong types
    if not isinstance(response_dict, dict):
        logging.error(f"get_ai_response_text: expected dict, got {type(response_dict).__name__}")
        safe = html.escape("" if response_dict is None else str(response_dict))
        return (
            f"<h3>{default_title}</h3>"
            f"<p style='color:#b00'><i>No structured AI response available.</i></p>"
            f"<pre style='white-space:pre-wrap'>{safe}</pre>"
        )

    model_used = response_dict.get("model_used", "N/A")
    provider = response_dict.get("provider", "AI")
    if response_dict.get("error"):
        err_msg = response_dict["error"]
        logging.error(f"Error in AI response for '{default_title}': {err_msg}")
        return (f"<h3>{default_title}</h3>"
                f"<p style='color:red;'><i>Error (Model: {model_used}, Provider: {provider}): "
                f"{html.escape(str(err_msg))}</i></p>")
    raw_text = response_dict.get("raw_text", "")
    if not raw_text:
        return (f"<h3>{default_title}</h3>"
                f"<p><i>(Model: {model_used}, Provider: {provider}) No content.</i></p>")
    cleaned = raw_text.strip()
    if (cleaned.startswith('{') and cleaned.endswith('}')) or (cleaned.startswith('[') and cleaned.endswith(']')):
        try:
            parsed_json = json.loads(cleaned)
            if isinstance(parsed_json, list) and all(isinstance(i, str) for i in parsed_json):
                items_html = "".join([f"<li>{html.escape(i)}</li>" for i in parsed_json])
                return (f"<h3>{default_title} (List)</h3>"
                        f"<p style='font-size:0.8em; color:grey;'><i>(M:{model_used},P:{provider})</i></p>"
                        f"<ul>{items_html}</ul>")
            formatted_json = json.dumps(parsed_json, indent=2)
            escaped_json = html.escape(formatted_json)
            return (f"<h3>{default_title} (JSON)</h3>"
                    f"<p style='font-size:0.8em; color:grey;'><i>(M:{model_used},P:{provider})</i></p>"
                    f"<pre><code>{escaped_json}</code></pre>")
        except json.JSONDecodeError:
            logging.warning(f"AI response for '{default_title}' looked like JSON but failed: {raw_text[:100]}...")

    # paragraphify
    paras = raw_text.strip().split('\n')
    html_out, current_lines = "", []
    for line in paras:
        s_line = line.strip()
        if not s_line:
            if current_lines:
                html_out += f"<p>{html.escape(' '.join(current_lines))}</p>\n"
                current_lines = []
        else:
            current_lines.append(s_line)
    if current_lines:
        html_out += f"<p>{html.escape(' '.join(current_lines))}</p>\n"
    return (f"<h3>{default_title}</h3>"
            f"<p style='font-size:0.8em; color:grey;'><i>(M:{model_used},P:{provider})</i></p>\n{html_out}")


def build_context_for_ai(section_name_for_prompting_ai, df_full, results_so_far, max_tokens_approx_chars=12000):
    context_parts = [
        f"You are an expert research assistant. Generate the '{section_name_for_prompting_ai}' section for a bibliometric analysis report."]
    num_items = len(df_full) if df_full is not None else "unknown";
    context_parts.append(f"\nAnalysis based on {num_items} items.")
    if df_full is not None and not df_full.empty:
        if 'year' in df_full.columns:
            years = pd.to_numeric(df_full['year'], errors='coerce').dropna()
            if not years.empty: context_parts.append(
                f"Data covers ~{int(years.min()) if pd.notna(years.min()) else 'N/A'} to {int(years.max()) if pd.notna(years.max()) else 'N/A'}.")
        sample_info = []
        if 'title' in df_full.columns: s_titles = df_full['title'].dropna().head(
            1).tolist(); s_titles and sample_info.append(f"Sample title: '{html.escape(s_titles[0])}'")
        if 'abstract' in df_full.columns: s_abs = df_full['abstract'].dropna().str.slice(0, 100).head(
            1).tolist(); s_abs and sample_info.append(f"Abstract snippet: '{html.escape(s_abs[0])}...'")
        if sample_info: context_parts.append("Sample data: " + " | ".join(sample_info))
    if results_so_far:
        # include active section context if the caller set it (through _inject_ctx)
        active_id = results_so_far.get("active_section_id", "")
        rq_map = results_so_far.get("rq_by_section", {})
        ap_map = results_so_far.get("additional_prompt_by_section", {})
        kw_map = results_so_far.get("keywords_by_section", {})
        if active_id:
            rq = (rq_map.get(active_id) or "").strip()
            ap = (ap_map.get(active_id) or "").strip()
            kws = [k for k in (kw_map.get(active_id) or []) if str(k).strip()]
            if rq or ap or kws:
                context_parts.append("\nActive section guidance:")
                if rq:  context_parts.append(f"- Research question/problem: {rq}")
                if ap:  context_parts.append(f"- Additional prompt: {ap}")
                if kws: context_parts.append(f"- Keywords: {', '.join(kws[:15])}")
        context_parts.append("\nSummary of previous analysis steps/data available:")

        def _clean_html_for_context(html_str):
            if not isinstance(html_str, str): return str(html_str or "")
            soup = BeautifulSoup(html_str, "html.parser")
            for tag in soup.find_all(['h3', 'h4', 'pre', 'code']): tag.decompose()
            for p_tag in soup.find_all('p'):
                if p_tag.get('style') and 'font-size:0.8em' in p_tag['style']: p_tag.decompose()
            text = soup.get_text(separator=' ', strip=True);
            text = re.sub(r'\s+', ' ', text).strip()
            return text[:150] + "..." if len(text) > 150 else text

        for step_key, res_info in results_so_far.items():
            if not isinstance(res_info, dict) or "type" not in res_info: continue
            res_type, res_data, res_desc = res_info["type"], res_info.get("data"), res_info.get("description",
                                                                                                str(step_key))
            line = f"- {res_desc} ({step_key}): "
            if res_type == "html_section":
                actual_html_content = res_data.get("response_html", "") if isinstance(res_data,
                                                                                      dict) else res_data if isinstance(
                    res_data, str) else ""
                line += f"AI section output: '{_clean_html_for_context(actual_html_content)}'" if actual_html_content else "AI section (no content)."
            elif res_type == "ai_review_round1_output" and isinstance(res_data, dict):
                line += f"Reviewer (R1) feedback received, suggesting {len(res_data.get('search_keywords_phrases', []))} search KWs."
            elif res_type == "coded_notes_list" and isinstance(res_data, list):
                line += f"Extracted {len(res_data or [])} notes. Example KWs: {', '.join(set(n.get('keyword_found', '?') for n in (res_data or [])[:2] if isinstance(n, dict)))}."
            elif res_type == "keyword_list" and isinstance(res_data, list):
                line += f"Keywords: {', '.join((res_data or [])[:3])}{'...' if len(res_data or []) > 3 else ''}."
            elif res_type == "plotly_html_summary":
                line += f"Visualization '{res_desc}' produced."
                if isinstance(res_data, dict) and "keyword_clusters_data" in res_data:
                    cluster_summary = res_data["keyword_clusters_data"].get("summary_text",
                                                                            "Keyword cluster details available.")
                    line += f" Cluster Summary: '{_clean_html_for_context(cluster_summary)[:100]}...'"
            elif res_type == "table_summary":
                line += "Tabular data generated."
            elif res_type == "raw_df_full_summary":
                line += f"Dataset loaded (shape: {res_info.get('full_df_shape', '?')})."
            elif res_type == "author_keywords_map":
                line += f"Author-specific keywords generated for {len(res_data if isinstance(res_data, dict) else [])} items."
            elif res_type == "keyword_cluster_search_terms_map":
                line += f"Search terms suggested for {len(res_data if isinstance(res_data, dict) else [])} keyword clusters."
            elif str(step_key).endswith(("_InitialDraftFullPkg", "_ReviewR1OutputFullPkg", "_ExtractedNotesPkg")):
                continue
            else:
                line += f"Type '{res_type}' data available."
            context_parts.append(line)
    full_context = "\n".join(context_parts)
    if len(full_context) > max_tokens_approx_chars: full_context = full_context[
                                                                   :max_tokens_approx_chars] + "\n...(Context truncated)..."
    logging.debug(
        f"Context for {section_name_for_prompting_ai} (len {len(full_context)} chars):\n{full_context[:500]}...")
    return full_context


def get_batch_root(app_name: str | None = None, override_root: str | None = None) -> Path:
    """
    Determine the base directory to store batch input/output files.

    Priority:
      1) env var BATCH_ROOT (absolute path)
      2) override_root argument (absolute or relative)
      3) OS app-data path + app_name (defaults to 'annotarium')

    Returns a Path and ensures it exists.
    """
    # Use private aliases to avoid any name shadowing in caller modules
    import os as _os
    import platform as _platform
    from pathlib import Path as _Path

    # 1) Environment override
    env_root = _os.getenv("BATCH_ROOT")
    if env_root:
        root = _Path(env_root).expanduser().resolve()
        root.mkdir(parents=True, exist_ok=True)
        batches_dir = root / "batches"
        batches_dir.mkdir(parents=True, exist_ok=True)
        return batches_dir

    # 2) Explicit override
    if override_root:
        root = _Path(override_root).expanduser().resolve()
        root.mkdir(parents=True, exist_ok=True)
        batches_dir = root / "batches"
        batches_dir.mkdir(parents=True, exist_ok=True)
        return batches_dir

    # 3) OS-appropriate default
    name = (app_name or "annotarium").strip()
    # Ensure we don't accidentally treat a full filesystem path as the "app name"
    # Replace path separators to keep it as a single folder name.
    name = name.replace("\\", "_").replace("/", "_")

    system = _platform.system()
    if system == "Windows":
        base = _Path(_os.getenv("APPDATA", str(_Path.home() / "AppData" / "Roaming"))) / name
    elif system == "Darwin":
        base = _Path.home() / "Library" / "Application Support" / name
    else:
        base = _Path.home() / ".local" / "share" / name

    root = (base / "Batching_files").resolve()
    root.mkdir(parents=True, exist_ok=True)
    batches_dir = root / "batches"
    batches_dir.mkdir(parents=True, exist_ok=True)

    return batches_dir

def _read_file_bytes_safely(client, file_id) -> bytes:
    """
    Normalise file-content retrieval across OpenAI Python SDK variants (incl. 1.78.x).
    Tries: files.content().read() → .content() → .content → .text → .iter_bytes().
    """
    # 1) Newer SDK path: prefer .content(...) handle-like object
    try:
        h = client.files.content(file_id)
        # Try stream-style read()
        read = getattr(h, "read", None)
        if callable(read):
            data = read()
            if data:
                return data if isinstance(data, (bytes, bytearray)) else bytes(data)

        # Try .content() method (as hinted by your warning)
        meth = getattr(h, "content", None)
        if callable(meth):
            data = meth()
            if data:
                return data if isinstance(data, (bytes, bytearray)) else bytes(data)

        # Try .content attribute (legacy/httpx-like)
        if hasattr(h, "content") and not callable(getattr(h, "content")):
            data = getattr(h, "content")
            if data:
                return data if isinstance(data, (bytes, bytearray)) else bytes(data)

        # Try .text (common for batch outputs that are JSONL text)
        if hasattr(h, "text"):
            txt = getattr(h, "text")
            # .text may be a property or a method returning str
            txt = txt() if callable(txt) else txt
            if isinstance(txt, str):
                return txt.encode("utf-8")

        # Try iter_bytes() generator
        it = getattr(h, "iter_bytes", None)
        if callable(it):
            chunks = []
            for chunk in it():
                if chunk:
                    chunks.append(chunk if isinstance(chunk, (bytes, bytearray)) else bytes(chunk))
            if chunks:
                return b"".join(chunks)
    except Exception:
        # Fall back to raw-response flow below
        pass

    # 2) Raw-response fallback for older examples
    resp = client.files.with_raw_response.retrieve_content(file_id=file_id)

    # Prefer callable .content()/.read(), then attribute .content
    for getter in ("content", "read"):
        try:
            g = getattr(resp, getter, None)
            if callable(g):
                data = g()
                if data:
                    return data if isinstance(data, (bytes, bytearray)) else bytes(data)
            elif g is not None:
                return g if isinstance(g, (bytes, bytearray)) else bytes(g)
        except Exception:
            continue

    raise RuntimeError("Failed to extract bytes from OpenAI file content; no usable method/attribute found.")


def _process_batch_for(
    analysis_key_suffix: str,
    completion_window: str = "24h",
    section_title: str = "",
    poll_interval: int = 30,
    store_only: bool = False,
) -> bool:
    """
    Process a single function's batch and persist its output.
    Compatible with SDKs where retrieve_content requires .content()/.read().
    """
    import json, time, logging
    from pathlib import Path
    import openai as _openai
    from openai import OpenAI
    client = OpenAI(api_key=OPENAI_API_KEY)
    logging.info("openai-python version: %s", getattr(_openai, "__version__", "unknown"))

    root: Path = get_batch_root()
    func_dir = root / analysis_key_suffix
    func_dir.mkdir(parents=True, exist_ok=True)

    safe_prefix = f"{section_title}_{analysis_key_suffix}"
    meta_path   = func_dir / f"{safe_prefix}_batch_metadata.json"
    input_path  = func_dir / f"{safe_prefix}_input.jsonl"
    output_path = func_dir / f"{safe_prefix}_output.jsonl"

    if output_path.exists():
        return True
    if not input_path.exists():
        logging.warning("Batch input not found: %s", input_path)
        return False

    batch_id = None
    input_file_id = None

    if meta_path.exists():
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
            batch_id = meta.get("batch_id")
            input_file_id = meta.get("input_file_id")
        except Exception as e:
            logging.warning("Could not read meta; recreating batch. Err: %s", e)

    if not batch_id or not input_file_id:
        with open(input_path, "rb") as fh:
            upload = client.files.create(file=fh, purpose="batch")
        input_file_id = upload.id
        batch = client.batches.create(
            input_file_id=input_file_id,
            endpoint="/v1/responses",
            completion_window=completion_window,
        )
        batch_id = batch.id
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump({"batch_id": batch_id, "input_file_id": input_file_id}, f)

    last_status = None
    while True:
        b = client.batches.retrieve(batch_id)
        status = getattr(b, "status", None)
        if status != last_status:
            logging.info("Batch %s status: %s", batch_id, status)
            last_status = status
        if status == "completed":
            output_file_id = getattr(b, "output_file_id", None)
            if not output_file_id:
                raise RuntimeError(f"Batch {batch_id} completed but has no output_file_id")
            break
        if status in ("failed", "cancelled", "expired"):
            raise RuntimeError(f"Batch {batch_id} ended in status '{status}'")
        time.sleep(poll_interval)

    # ---- Robust download: handle method vs attribute change
    data_bytes = _read_file_bytes_safely(client, output_file_id)
    with open(output_path, "wb") as out:
        out.write(data_bytes)

    return True

def load_prompt_config(key, config_file_path_str=r"C:\Users\luano\PycharmProjects\Back_end_assis\Prompts\api_prompts.json"):
    """Loads task-specific configuration from the JSON file."""
    import json
    env_prompt_path = os.getenv("API_PROMPTS_PATH", "").strip()
    default_repo_prompt = Path(__file__).resolve().parents[2] / "electron_zotero" / "api_prompts.json"
    fallback_local_prompt = Path(__file__).resolve().parent / "api_prompts.json"

    candidates = []
    if env_prompt_path:
        candidates.append(Path(env_prompt_path))
    candidates.append(default_repo_prompt)
    candidates.append(Path(config_file_path_str))
    candidates.append(fallback_local_prompt)

    config_file = None
    for cand in candidates:
        try:
            p = Path(cand).expanduser().resolve()
        except Exception:
            continue
        if p.is_file():
            config_file = p
            break
    if config_file is None:
        config_file = Path(config_file_path_str)

    default_return = {"prompt": "", "default_model": {}, "def_temperature": None,
                      "openai_tool_schema": None}  # Added openai_tool_schema to defaults

    if not config_file.is_file():  # Now this will work
        print(f"Error: Prompt config file '{config_file.resolve()}' not found.")
        return default_return
    try:
        with open(config_file, 'r', encoding='utf-8') as f:
            config_data = json.load(f)

        task_specific_config = config_data.get(key)  # Get the config for the specific key
        if not task_specific_config:
            print(f"Warning: No config for key '{key}' in {config_file.name}. Using defaults.")
            return default_return

        # Ensure default_model is a dict, handle old format gracefully
        if "default_model" not in task_specific_config or not isinstance(task_specific_config["default_model"], dict):
            if "default_model" in task_specific_config:
                print(f"Warning: 'default_model' for key '{key}' is not a dictionary. Ignoring and using empty dict.")
            task_specific_config["default_model"] = {}

        if "def_temperature" in task_specific_config and task_specific_config["def_temperature"] is not None:
            try:
                task_specific_config["def_temperature"] = float(task_specific_config["def_temperature"])
            except (ValueError, TypeError):
                print(f"Warning: Invalid temp '{task_specific_config['def_temperature']}' for key '{key}'. Using None.")
                task_specific_config["def_temperature"] = None

        # Ensure openai_tool_schema exists, default to None if not
        if "openai_tool_schema" not in task_specific_config:
            task_specific_config["openai_tool_schema"] = None

        # Merge the loaded task_specific_config with defaults to ensure all expected keys are present
        # Only override defaults if the key exists in task_specific_config
        final_config = default_return.copy()  # Start with all defaults
        final_config.update(task_specific_config)  # Update with loaded values

        return final_config

    except Exception as e:
        print(f"Error loading or processing prompt config from '{config_file.resolve()}': {e}")
        return default_return

def call_models_zt( text: str, function: str,
                 custom_id: str,

                 document: str = None, vision: bool = False,
                model: str="gpt-5-mini",  # Default to OpenAI models
                dynamic_image_path: Path | str | None = None,
                collection_name: str = "",
                read: bool = False,
                store_only: bool = False,
                ai: str="openai",
                by_index=None,

                base_output_dir: Path | None = None,
                 cache: bool = True,
                 cache_dir: Path | None = None,
                 ):
    """
    Generates response from AI model, handling vision (Gemini w/ Pillow) & docs (Mistral).
    Uses provider-specific default models from config. Corrects Gemini call structure.
    """

    import json
    no_temperature = ["gpt-5-mini"]

    from datetime import datetime
    import logging
    import json as _json
    from pathlib import Path
    try:
        project_root = Path(__file__).resolve().parent.parent
    except Exception:
        project_root = Path.cwd()
    _cache_dir = cache_dir if cache_dir else (project_root / ".cache" / "call_models")
    _cache_dir.mkdir(parents=True, exist_ok=True)
    import re, hashlib

    def _sanitize_for_filename(s: str) -> str:
        s = s if isinstance(s, str) else str(s)
        s = s.strip()
        # replace Windows-reserved and problematic chars (\, /, :, *, ?, ", <, >, |) and collapse whitespace
        s = re.sub(r'[\\/:*?"<>|]+', '_', s)
        s = re.sub(r'\s+', '_', s)
        # keep a conservative charset to avoid filesystem quirks
        s = re.sub(r'[^0-9A-Za-z._-]+', '_', s)
        # keep it reasonably short; empty fallback
        return s[:120] or "key"

    key_hash = hashlib.sha1(f"{collection_name}::{custom_id}".encode("utf-8")).hexdigest()[:8]
    safe_collection = _sanitize_for_filename(collection_name)
    safe_custom = _sanitize_for_filename(custom_id)
    cache_file_path = _cache_dir / f"{safe_collection}__{safe_custom}_{key_hash}.json"
    if cache and cache_file_path.is_file():
        try:
            with open(cache_file_path, "r", encoding="utf-8") as f_cache:
                cached = _json.load(f_cache)
            logging.info(f"CACHE HIT: {cache_file_path}")
            return cached
        except Exception as _e:
            logging.warning(f"CACHE READ FAILED: {cache_file_path} -> {_e}")

    all_responses = []
    try:
        task_config = load_prompt_config(function)
    except Exception:
        task_config = {}

    # Fallback absolute-path probe if empty (robust to CWD changes)
    if not task_config:
        import json, os
        from pathlib import Path
        here = Path(__file__).resolve().parent
        for candidate in ["api_prompts.json", "prompts.json"]:
            p = here / candidate
            if p.is_file():
                with p.open("r", encoding="utf-8") as fh:
                    all_prompts = json.load(fh)
                task_config = all_prompts.get(function, {})
                if task_config:
                    break

    # Robust look-ups with fallbacks ↓↓↓
    task_content = (
            task_config.get("content")
            or task_config.get("prompt", "")
    )

    full_prompt = ""

    # ── 2. Build full_prompt exactly once  ─────────────────────────────
    # Fast path for the functions that explicitly use a placeholder
    if function in ["paper_coding", "coding_keyword", "paper_coding1", "paper_coding2",
                    "paper_affiliation_and_entities"]:
        if isinstance(task_content, str):
            full_prompt = task_content.replace("{payload_placeholder}", text)

    try:
        payload = json.loads(text)

        # Only stringify 'records' if it exists and is list/dict
        if isinstance(payload, dict) and "records" in payload and isinstance(payload["records"], (list, dict)):
            payload["records"] = json.dumps(payload["records"], indent=2)

        # If full_prompt not set by the placeholder path, build it from JSON payload
        if not full_prompt:
            # If the task content itself has the placeholder, fill it with the pretty JSON
            if "{payload_placeholder}" in task_content:
                full_prompt = task_content.replace("{payload_placeholder}",
                                                   json.dumps(payload, indent=2, ensure_ascii=False))
            else:
                full_prompt = f"{task_content}\n\n{json.dumps(payload, indent=2, ensure_ascii=False)}"

    except json.JSONDecodeError:
        # Not JSON; just append raw text
        if not full_prompt:
            full_prompt = f"{task_content}\n\n{text}"

    # Get the DICT of default models for this task
    task_default_models = task_config.get("default_model", {})
    # task_default_temp = task_config.get("def_temperature")
    openai_schema = task_config.get("property")

    # 1) Compute & create the function‐specific folder

    batch_root = get_batch_root()
    safe_collection = safe_name(collection_name)
    safe_function = safe_name(function)

    func_dir = batch_root / safe_function
    func_dir.mkdir(parents=True, exist_ok=True)

    input_file = func_dir / f"{safe_collection}_{safe_function}_input.jsonl"
    output_file = func_dir / f"{safe_collection}_{safe_function}_output.jsonl"





    # --- 1. Load or initialize metadata ---
    if read:


        response = read_completion_results(custom_id=custom_id, path=str(output_file), function=function, by_index=by_index)
        if response:
            return response
        if not response:
            print(f"DEBUG: No responses found in {output_file}. Proceeding to generate new responses.")
            input("Press Enter to continue...")

    if store_only:
        schema: dict = task_config.get("json_schema")
        current_model=model
        batch_request = prepare_batch_requests(
            text_to_send=full_prompt,
            content=task_content,
            schema_wrapper=openai_schema,
            model=current_model,
            custom_id=custom_id,
            # temperature=task_default_temp or 0.5 # ✅ already safe
        )

        write_batch_requests_to_file(batch_request=batch_request,file_name=str(input_file))

        return batch_request,False


    # --- Determine Image Path & Validate ---
    actual_image_path = None
    if vision:

        if dynamic_image_path:
            current_image_path = Path(dynamic_image_path)
            if base_output_dir and not current_image_path.is_absolute():
                actual_image_path = (base_output_dir / current_image_path).resolve()
            else:
                actual_image_path = current_image_path.resolve()
            if not actual_image_path.is_file():
                error_msg = f"Error: Dynamic image path non-existent: '{actual_image_path}' for key '{function}'"
                print(error_msg);
                providers_to_run = [ai] if ai != "all" else ["mistral", "openai", "gemini"]
                return [{"provider": p, "error": error_msg} for p in providers_to_run if
                        p != "deepseek"] if ai == "all" else {"provider": ai, "error": error_msg}
            print(f"  Using resolved dynamic image path: {actual_image_path}")
        else:
            error_msg = f"Error: Vision mode enabled but no dynamic_image_path provided for key '{function}'."
            print(error_msg);
            providers_to_run = [ai] if ai != "all" else ["mistral", "openai", "gemini"]
            return [{"provider": p, "error": error_msg} for p in providers_to_run if
                    p != "deepseek"] if ai == "all" else {"provider": ai, "error": error_msg}

    # --- Input Validation (DeepSeek Vision, Document Provider) ---
    # ... (validation logic remains the same) ...
    if vision and ai == "deepseek":
        new_msg = ""
    if document and ai != 'mistral' and ai != 'all':
        print(f"Warning: Document processing only for Mistral. Ignoring document for '{ai}'.")
        document = None


    base64_image, mime_type = None, None
    pil_image_for_gemini = None


    # --- Determine Providers to Run ---
    # ... (provider determination logic remains the same) ...
    providers_to_execute = []
    if ai == "all":
        providers_to_execute = ["mistral", "openai", "gemini", "deepseek"]
    elif ai in ["mistral", "openai", "gemini", "deepseek"]:
        providers_to_execute = [ai]
    else:
        raise ValueError(f"Unsupported AI provider: {ai}")

    # --- Iterate and Call Providers ---
    for provider in providers_to_execute:
        response_data = {"provider": provider}

        # --- Select Model and Temperature (Using Provider-Specific Defaults) ---
        current_model = model  # 1. Check input dict
        if not current_model:
            current_model = task_default_models.get(provider)  # 2. Check task config for this provider
        if not current_model:  # 3. Apply hardcoded provider default
            if provider == "mistral":
                current_model = "mistral-large-latest"
            elif provider == "openai":

                current_model = model

            elif provider == "gemini":
                current_model = "gemini-1.5-pro-latest"  # Adjust if needed
            elif provider == "deepseek":
                current_model = "deepseek-chat"
            print(f"  Using hardcoded default model for {provider}: {current_model}")


        try:


            # --- OpenAI ---
            # ---------- OPENAI via /v1/responses (o-series models) ----------
            if provider == "openai":

                if not OpenAI or not OPENAI_API_KEY:
                    raise ImportError("OpenAI client not configured.")
                client = OpenAI(api_key=OPENAI_API_KEY)

                # Build the input list required by /v1/responses
                openai_input = [
                    {"type": "message", "role": "system", "content": task_content},
                    {"type": "message", "role": "user", "content": full_prompt},
                ]

                if vision and base64_image:
                    openai_input[-1]["content"] = [
                        {"type": "text", "text": full_prompt},
                        {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{base64_image}"}},
                    ]

                # ---------- SCHEMA NORMALISATION SHIM ----------
                openai_function = None
                if isinstance(openai_schema, dict):
                    if "schema" in openai_schema and isinstance(openai_schema["schema"], dict):
                        openai_function = {
                            "name": openai_schema.get("name") or function,
                            "description": openai_schema.get("description", ""),
                            "parameters": openai_schema["schema"],
                        }
                    elif "parameters" in openai_schema and isinstance(openai_schema["parameters"], dict):
                        openai_function = {
                            "name": openai_schema.get("name") or function,
                            "description": openai_schema.get("description", ""),
                            "parameters": openai_schema["parameters"],
                        }
                    else:
                        openai_function = {
                            "name": function,
                            "description": f"Structured output for {function}",
                            "parameters": openai_schema,
                        }
                    params = openai_function.get("parameters")
                    if isinstance(params, dict) and params.get(
                            "type") == "object" and "additionalProperties" not in params:
                        params["additionalProperties"] = False
                # -----------------------------------------------

                # --- Assemble body for /v1/responses ---
                body = {
                    "model": current_model,
                    "input": openai_input,
                    "instructions": None,
                }
                # Optional: reasoning for non-legacy models
                if not current_model.lower().startswith("gpt-4"):
                    body["reasoning"] = {"effort": "high"}

                # Text vs JSON-schema — choose format based on presence of a function schema
                if openai_function:
                    body["text"] = {
                        "format": {
                            "type": "json_schema",
                            "name": openai_function["name"],
                            "schema": openai_function["parameters"],
                            "strict": True,
                        }
                    }
                else:
                    # Plain text/HTML
                    body["text"] = {"format": {"type": "text"}}

                # API call
                resp = client.responses.create(**body)

                assistant_msg = next(
                    (item for item in resp.output if getattr(item, "type", None) == "message"),
                    None,
                )
                if assistant_msg is None:
                    raise ValueError("No assistant message found in OpenAI Responses payload.")

                raw = "".join(
                    getattr(chunk, "text", "")
                    for chunk in assistant_msg.content
                ).strip()

                # Normalize depending on whether we asked for JSON
                response_data = {"provider": "openai"}

                if openai_function:
                    # We asked for JSON: try to parse, but DO NOT hard fail if it's text.
                    try:
                        parsed = json.loads(raw)
                        response_data["response"] = parsed
                    except json.JSONDecodeError:
                        # Fallback to raw text (HTML)
                        response_data["response"] = raw
                else:
                    # Plain text/HTML response
                    response_data["response"] = raw

                # Cache and return single-provider result
                if cache:
                    try:
                        cache_file_path.parent.mkdir(parents=True, exist_ok=True)
                        cacheable = {
                            "provider": "openai",
                            "result": response_data,
                            "cached_at": datetime.utcnow().isoformat() + "Z",
                            "collection_name": collection_name,
                            "custom_id": custom_id,
                            "function": function,
                        }
                        with open(cache_file_path, "w", encoding="utf-8") as f_cache:
                            _json.dump(cacheable, f_cache, indent=2)
                        logging.info(f"CACHE WRITE: Saved response to {cache_file_path}")
                    except Exception as _e:
                        logging.warning(f"CACHE WRITE FAILED ({cache_file_path}): {_e}")

                return response_data

        # --- Error Handling (Keep as before) ---
        except ImportError as imp_err:
            error_message = f"{imp_err}"
            print(f"  Configuration Error for {provider}: {error_message}")
            response_data["error"] = error_message
            if ai == "all":
                all_responses.append(response_data)
            else:
                return response_data
        except Exception as e:
            error_message = f"Error calling {provider} model '{current_model}': {e}"
            print(f"  {error_message}")
            response_data["error"] = f"Model '{current_model}': {e}"
            if ai == "all":
                all_responses.append(response_data)
            else:
                return response_data
        finally:
            # Ensure PIL image is closed if Gemini was called and used it
            if provider == "gemini" and 'pil_image_for_gemini' in locals() and pil_image_for_gemini and hasattr(
                    pil_image_for_gemini, 'fp') and pil_image_for_gemini.fp:
                try:
                    pil_image_for_gemini.close()
                except Exception:
                    pass

    # --- Return results ---
    if not providers_to_execute:
        raise ValueError("No valid AI providers specified or available.")

    final_payload = (
        all_responses if ai == "all"
        else all_responses[0] if all_responses
        else {"provider": ai, "error": "Provider execution failed."}
    )

    if cache:
        try:
            cache_file_path.parent.mkdir(parents=True, exist_ok=True)
            cacheable = {
                "provider": ai,
                "result": final_payload,
                "cached_at": datetime.utcnow().isoformat() + "Z",
                "collection_name": collection_name,
                "custom_id": custom_id,
                "function": function,
            }
            with open(cache_file_path, "w", encoding="utf-8") as f_cache:
                _json.dump(cacheable, f_cache, indent=2)
            logging.info(f"CACHE WRITE: Saved response to {cache_file_path}")
        except Exception as _e:
            logging.warning(f"CACHE WRITE FAILED ({cache_file_path}): {_e}")

    return final_payload

def call_models_na(
        text: str, function,
        custom_id: str = "123",
        properties: list | None = None,
        collection_name: str = "",
        read: bool = False,
        store_only: bool = False,
        current_model: str = "gpt-5-mini",
        current_temp: float = 0.6,

        by_index=None,
        prompts_path: str = r"C:\Users\luano\PycharmProjects\Back_end_assis\Prompts\api_prompts.json",
):
    """
    One-shot extractor that composes a JSON Schema and per-field instructions from prompts.json
    under function key 'extract_NA', then calls the Responses API once to return exactly those fields.

    Args:
        text: The academic paper text to analyse.
        custom_id: Identifier used for batching/readback.
        properties: List of field names to extract (e.g., ["abstract","controlled_vocabulary_terms","methods"]).
        collection_name: Name used to group batch input/output files.
        read: If True, try to read prior results from batch output and return them.
        store_only: If True, write a batch request JSONL and return without calling the API.
        current_model: Model name for the Responses API.
        current_temp: Temperature if the model supports it.
        by_index: Optional index for readback selection logic (passed through).
        prompts_path: Path to your prompts.json containing the 'extract_NA' block.

    Returns:
        (result_dict, False) where result_dict is the parsed JSON object produced by the model.
    """
    print("calling call_models_na")
    import json
    from copy import deepcopy

    print("DEBUG: call_models_na invoked")
    if not properties:
        raise ValueError("properties list must not be empty")

    # De-duplicate while preserving order
    seen = set()
    properties = [p for p in properties if not (p in seen or seen.add(p))]

    no_temperature = ["gpt-5-mini"]
    function = "extract_NA"

    # ---- helper: robust lookup for the function block in prompts.json ----
    def _get_task_config(prompts_cfg: dict, func: str) -> dict:
        # 1) direct top-level key
        if func in prompts_cfg and isinstance(prompts_cfg[func], dict):
            return prompts_cfg[func]
        # 2) nested under 'functions'
        fn_bucket = prompts_cfg.get("functions")
        if isinstance(fn_bucket, dict) and func in fn_bucket and isinstance(fn_bucket[func], dict):
            return fn_bucket[func]
        # 3) any block with json_schema.name == func
        for k, v in prompts_cfg.items():
            if isinstance(v, dict):
                js = v.get("json_schema")
                if isinstance(js, dict) and js.get("name") == func:
                    return v
        # 4) not found
        raise KeyError(
            f"Function '{func}' not found. Checked top-level key, 'functions' bucket, and json_schema.name in: {prompts_path}"
        )

    # ---------- load prompts.json and the function block ----------
    try:
        with open(prompts_path, "r", encoding="utf-8") as f:
            prompts_cfg = json.load(f)
    except FileNotFoundError as e:
        raise FileNotFoundError(f"prompts.json not found at: {prompts_path}") from e
    except json.JSONDecodeError as e:
        raise ValueError(f"prompts.json is not valid JSON: {prompts_path}") from e

    if not isinstance(prompts_cfg, dict):
        raise ValueError(f"prompts.json root must be an object: {prompts_path}")

    task_config = _get_task_config(prompts_cfg, function)

    # ---------- base JSON Schema container ----------
    base_wrapper = task_config.get("json_schema", None)
    if base_wrapper and isinstance(base_wrapper, dict) and "schema" in base_wrapper:
        # start from a clean object, we will override properties and required
        parameters_schema = {"type": "object", "properties": {}, "required": [], "additionalProperties": False}
    else:
        parameters_schema = {"type": "object", "properties": {}, "required": [], "additionalProperties": False}

    parameters_schema["required"] = list(properties)
    parameters_schema["additionalProperties"] = False

    # ---------- build per-field prompts + property schemas ----------
    numbered_rules = []
    for idx, prop in enumerate(properties, start=1):
        field_cfg = task_config.get(prop)
        if not field_cfg:
            available = [k for k in task_config.keys() if k not in ("json_schema",)]
            raise KeyError(
                f"Missing property config for '{prop}' under '{function}'. "
                f"Available keys: {available}"
            )
        field_prompt = (field_cfg.get("prompt") or "").strip()
        field_schema = field_cfg.get("property")
        if not isinstance(field_schema, dict):
            raise KeyError(f"Invalid or missing 'property' JSON Schema for '{prop}'")

        parameters_schema["properties"][prop] = deepcopy(field_schema)
        numbered_rules.append(f"{idx}. {field_prompt}")

    # ---------- system + user content ----------
    task_content = (
        "System: You extract structured fields from an academic paper. "
        "Return exactly one JSON object containing only the requested fields. "
        "Adhere strictly to the provided JSON Schema types/enums; do not add extra keys. "
        "If a scalar has no support, return \"None\"; for arrays, return []. Use British English."
    )

    requested_str = ", ".join(properties)
    full_prompt = (
            f"You will be given an academic paper. Your objective is to extract the following fields: [{requested_str}]\n"
            "Follow these field-specific rules:\n"
            + "\n".join(numbered_rules)
            + "\n\nAcademic paper to be analysed:\n"
            + text
    )

    # ---------- batching paths ----------
    client = OpenAI(api_key=OPENAI_API_KEY)
    root = get_batch_root()  # …/Batching_files
    func_dir = root / function  # …/Batching_files/<function>
    func_dir.mkdir(parents=True, exist_ok=True)

    # NOTE: include function in meta filename to avoid collisions!
    input_file  = func_dir / f"{collection_name}_{function}_input.jsonl"
    output_file = func_dir / f"{collection_name}_{function}_output.jsonl"

    # ---------- read mode ----------
    if read:
        response = read_completion_results(
            custom_id=custom_id,
            path=str(output_file),
            function=function,
            by_index=by_index
        )
        if response:
            print(f"DEBUG: Read {len(response)} responses from {output_file}")
            return response
        print(f"DEBUG: No responses found in {output_file}. Proceeding to generate new responses.")
        input("Press Enter to continue...")

    # ---------- store-only (batch file) ----------
    if store_only:
        schema_wrapper = {
            "name": (base_wrapper.get("name") if isinstance(base_wrapper, dict) else function) or function,
            "schema": parameters_schema,
        }
        batch_request = prepare_batch_requests(
            text_to_send=full_prompt,
            content=task_content,
            schema_wrapper=schema_wrapper,
            model=current_model,
            custom_id=custom_id,

            # temperature=current_temp if current_model.lower() not in [m.lower() for m in no_temperature] else None,
        )
        write_batch_requests_to_file(batch_request=batch_request, file_name=str(input_file))
        return batch_request, False

    # ---------- online call ----------
    openai_input = [
        {"type": "message", "role": "system", "content": task_content},
        {"type": "message", "role": "user", "content": full_prompt},
    ]

    json_format = {
        "type": "json_schema",
        "name": (base_wrapper.get("name") if isinstance(base_wrapper, dict) else function) or function,
        "schema": parameters_schema,
        "strict": True,
    }

    body = {
        "model": current_model,
        "input": openai_input,
        "instructions": None,
    }
    # if current_model.lower() not in [m.lower() for m in no_temperature]:
    # body["temperature"] = current_temp

    if not current_model.lower().startswith("gpt-4"):
        body["reasoning"] = {"effort": "high"}

    body["text"] = {"format": json_format}
    client = OpenAI(api_key=OPENAI_API_KEY)

    resp = client.responses.create(**body)
    assistant_msg = next((item for item in resp.output if getattr(item, "type", None) == "message"), None)
    if assistant_msg is None:
        raise ValueError("No assistant message found in OpenAI Responses payload.")

    raw = "".join(getattr(chunk, "text", "") for chunk in assistant_msg.content).strip()
    if not (raw.startswith("{") and raw.endswith("}")):
        raise ValueError(f"Expected a JSON object but got:\n{raw!r}")

    try:
        result = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"Failed to parse JSON: {e}\nraw text was: {raw!r}")

    return result, False

from pathlib import Path
from typing import Any, Dict, List, Optional, Union
import os
def submit_mistral_ocr3_batch(
    pdf_paths: List[Union[str, Path]],
    model: str = "mistral-ocr-latest",
    include_image_base64: bool = False,
    pages: Optional[List[int]] = None,
    metadata: Optional[Dict[str, str]] = None,
    cache_root: Optional[Union[str, Path]] = None,
) -> Dict[str, Any]:
    """
    Batch OCR using Mistral's /v1/ocr batch API.

    1) Resolve per-file cache directory (/files).
    2) For each PDF: if a usable per-file cache exists, load it; otherwise queue it for upload.
    3) If anything is queued: create one batch job for only those PDFs, then persist their per-file caches.
    4) Return a complete result list for all input PDFs (cached + newly processed), in stable path order.

    Cache entry shape (per PDF):
      {
        "pdf_path": "...",
        "custom_id": "...",
        "response": {...},                 # raw batch output line for that custom_id (or empty dict)
        "markdown": "...",                 # joined page markdown
        "structured_references": {...}     # parsed document_annotation -> dict, else {"references": []}
      }
    """
    from pathlib import Path
    import httpx, json, tempfile, time, os, hashlib, ssl, certifi

    home = Path.home()
    base = Path(cache_root) if cache_root else (home / "annotarium" / "cache" / "mistral")
    files_dir = base / "files"
    base.mkdir(parents=True, exist_ok=True)
    files_dir.mkdir(parents=True, exist_ok=True)

    pdf_list = [Path(p).expanduser().resolve() for p in pdf_paths]
    pdf_set = sorted({str(p) for p in pdf_list})

    def _canon(p: str) -> str:
        x = os.path.normpath(p)
        return os.path.normcase(x)

    def _custom_id_for(p: str) -> str:
        return hashlib.sha1(_canon(p).encode("utf-8")).hexdigest()[:12]

    def _cache_path_for(p: str) -> Path:
        h = hashlib.sha256(_canon(p).encode("utf-8")).hexdigest()
        return files_dir / f"{h}.json"

    def _find_cache_in_files_dir(p: str) -> Optional[Path]:
        cand_strs = [
            str(Path(p).expanduser().resolve()),
            _canon(str(Path(p).expanduser().resolve())),
            p,
            _canon(p),
        ]
        for s in cand_strs:
            h = hashlib.sha256(s.encode("utf-8")).hexdigest()
            f = files_dir / f"{h}.json"
            if f.is_file():
                return f
        return None

    def _has_min_cached_payload(d: Dict[str, Any]) -> bool:
        if not isinstance(d, dict):
            return False
        if not isinstance(d.get("response"), dict) or not d.get("response"):
            return False
        if "markdown" not in d:
            return False
        if "structured_references" not in d:
            return False
        sr = d.get("structured_references")
        if not isinstance(sr, dict):
            return False
        if not isinstance(sr.get("references", []), list):
            return False
        return True

    def _load_cached_entry(p: str) -> Optional[Dict[str, Any]]:
        f = _find_cache_in_files_dir(p)
        if not f:
            return None
        data = json.loads(f.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return None
        if not _has_min_cached_payload(data):
            return None
        if "pdf_path" not in data:
            data["pdf_path"] = str(Path(p).expanduser().resolve())
        if "custom_id" not in data:
            data["custom_id"] = _custom_id_for(p)
        return data

    def _extract_markdown_and_refs(batch_line_rec: Dict[str, Any]) -> Dict[str, Any]:
        """
        ###1. normalise batch record to the OCR body dict
        ###2. build pages=[{index, markdown}] and full markdown joined by \n\n
        ###3. parse document_annotation into structured_references
        """
        rec = batch_line_rec if isinstance(batch_line_rec, dict) else {}

        payload = rec.get("response")
        if isinstance(payload, dict) and isinstance(payload.get("body"), dict):
            payload = payload["body"]
        elif not isinstance(payload, dict):
            payload = rec.get("body")
        if not isinstance(payload, dict):
            payload = rec

        pages_out = payload.get("pages", [])
        pages_md: List[Dict[str, Any]] = []
        md_parts: List[str] = []

        if isinstance(pages_out, list):
            for pg in pages_out:
                if not isinstance(pg, dict):
                    continue
                idx = pg.get("index")
                md = pg.get("markdown")
                if not isinstance(md, str):
                    continue
                pages_md.append({"index": idx, "markdown": md})
                if md.strip():
                    md_parts.append(md)

        markdown = "\n\n".join(md_parts)

        sr: Dict[str, Any] = {"references": []}
        ann = payload.get("document_annotation") if isinstance(payload, dict) else None

        if isinstance(ann, str) and ann.strip():
            parsed = json.loads(ann)
            if isinstance(parsed, dict):
                refs = parsed.get("references")
                if isinstance(refs, list):
                    sr = parsed
                else:
                    sr = {"references": []}
                    sr["annotation_errors"] = [{"error": "annotation_references_not_list", "raw": parsed}]
        elif isinstance(ann, dict):
            if isinstance(ann.get("references"), list):
                sr = ann

        return {"markdown": markdown, "pages": pages_md, "structured_references": sr}

    cached_by_path: Dict[str, Dict[str, Any]] = {}
    to_upload: List[str] = []
    for p in pdf_set:
        c = _load_cached_entry(p)
        if c:
            cached_by_path[p] = c
        else:
            to_upload.append(p)

    ssl_context = ssl.create_default_context(cafile=certifi.where())
    ssl_context.minimum_version = ssl.TLSVersion.TLSv1_2
    transport = httpx.HTTPTransport(retries=5, verify=ssl_context)
    timeout = httpx.Timeout(connect=60.0, read=240.0, write=240.0, pool=60.0)

    limits = httpx.Limits(
        max_connections=1,
        max_keepalive_connections=0,
        keepalive_expiry=0.0,
    )

    headers = {
        "Connection": "close",
        "Accept-Encoding": "identity",
    }

    client = httpx.Client(
        http2=False,
        timeout=timeout,
        limits=limits,
        transport=transport,
        trust_env=True,
        verify=ssl_context,
        headers=headers,
    )
    mistral = Mistral(api_key=api_key, client=client)
    uploaded: List[Dict[str, Any]] = []
    for p_str in tqdm(to_upload, desc="Uploading PDFs to Mistral OCR", unit="pdf"):
        p = Path(p_str)

        client.close()
        client = httpx.Client(
            http2=False,
            timeout=timeout,
            limits=limits,
            transport=httpx.HTTPTransport(retries=5, verify=ssl_context),
            trust_env=True,
            verify=ssl_context,
            headers=headers,
        )
        mistral = Mistral(api_key=api_key, client=client)

        with p.open("rb") as fh:
            res = mistral.files.upload(
                file={"file_name": p.name, "content": fh},
                purpose="ocr",
            )

        uploaded.append(
            {
                "custom_id": _custom_id_for(str(p)),
                "pdf_path": str(p),
                "file_id": res.id,
            }
        )

    output_data: Dict[str, Any] = {}
    job_id = None
    status_str = None

    if uploaded:
        batch_lines: List[str] = []
        for item in uploaded:
            signed = mistral.files.get_signed_url(file_id=item["file_id"]).url
            body: Dict[str, Any] = {
                "document": {"type": "document_url", "document_url": signed},
                "document_annotation_format": {"type": "json_schema", "json_schema": MISTRAL_REFERENCES_SCHEMA},
            }
            if pages:
                body["pages"] = pages
            batch_lines.append(json.dumps({"custom_id": item["custom_id"], "body": body}, ensure_ascii=False))

        fd, path_str = tempfile.mkstemp(suffix=".jsonl")
        os.close(fd)
        p_batch = Path(path_str)

        with p_batch.open("w", encoding="utf-8", newline="\n") as f:
            for line in batch_lines:
                f.write(line)
                f.write("\n")

        with p_batch.open("rb") as fh:
            batch_file_rep = mistral.files.upload(file={"file_name": p_batch.name, "content": fh}, purpose="batch")
        p_batch.unlink()

        job = mistral.batch.jobs.create(
            input_files=[batch_file_rep.id],
            model=model,
            endpoint="/v1/ocr",
            metadata=metadata or {},
        )
        job_id = job.id

        start_ts = time.time()
        while True:
            status = mistral.batch.jobs.get(job_id=job.id)
            status_str = getattr(status, "status", None)
            if status_str not in {"QUEUED", "RUNNING"}:
                break
            if time.time() - start_ts > 3600:
                raise RuntimeError("Batch OCR timeout")
            time.sleep(5)

        output_file_id = getattr(status, "output_file", None)
        if output_file_id:
            stream = mistral.files.download(file_id=output_file_id)
            raw = stream.read().decode("utf-8", errors="replace")
            for line in raw.splitlines():
                if line.strip():
                    rec = json.loads(line)
                    cid = rec.get("custom_id")
                    if cid:
                        output_data[str(cid)] = rec

        for item in uploaded:
            cid = item["custom_id"]
            pdf_path = item["pdf_path"]
            out = output_data.get(cid, {})
            extracted = _extract_markdown_and_refs(out if isinstance(out, dict) else {})

            entry = {
                "pdf_path": pdf_path,
                "custom_id": cid,
                "response": out if isinstance(out, dict) else {},
                "markdown": extracted.get("markdown") or "",
                "pages": extracted.get("pages") or [],
                "structured_references": extracted.get("structured_references") or {"references": []},
            }

            _cache_path_for(pdf_path).write_text(json.dumps(entry, ensure_ascii=False, indent=2), encoding="utf-8")
            cached_by_path[pdf_path] = entry

    final_list: List[Dict[str, Any]] = []
    for p in pdf_set:
        e = cached_by_path.get(p)
        if e:
            final_list.append(e)
        else:
            final_list.append(
                {
                    "pdf_path": p,
                    "custom_id": _custom_id_for(p),
                    "response": {},
                    "markdown": "",
                    "pages": [],
                    "structured_references": {"references": []},
                }
            )

    return {
        "processed": final_list,
        "job_id": job_id,
        "status": status_str,
    }


#
# pdfs =['C:\\Users\\luano\\Zotero\\storage\\3R2MZGXM\\(Yael Ronen, 2020).pdf', 'C:\\Users\\luano\\Zotero\\storage\\2DFBFQRI\\Mikanagi and Macak - 2020 - Attribution of cyber operations an  international law perspective on the park jin hyok case.pdf', 'C:\\Users\\luano\\Zotero\\storage\\9EGP9PBM\\Nye - 2016 - Deterrence and dissuasion in cyberspace.pdf', 'C:\\Users\\luano\\Zotero\\storage\\Q7HZWRBA\\Schmitt - 1999 - Computer Network Attack and the Use of Force in International Law Thoughts on a Normative Framework.pdf', 'C:\\Users\\luano\\Zotero\\storage\\RPMI77E8\\Prescott - 2011 - War by analogy US cyberspace strategy and international humanitarian law.pdf', 'C:\\Users\\luano\\Zotero\\storage\\ICAKJ5L5\\Kodar - 2009 - Computer network attacks in the grey areas of jus ad bellum and jus in bello.pdf', 'C:\\Users\\luano\\Zotero\\storage\\Y43F6E7G\\Joyner and Lotrionte - 2001 - Information warfare as international coercion elements of a legal framework.pdf', 'C:\\Users\\luano\\Zotero\\storage\\QUTGADTW\\viewcontent.cgi.pdf', 'C:\\Users\\luano\\Zotero\\storage\\VC3J6RSK\\IVE6FH53.pdf', 'C:\\Users\\luano\\Zotero\\storage\\G8S42VK6\\Baram - 2025 - When intelligence agencies publicly attribute offensive cyber operations illustrative examples from.pdf', 'C:\\Users\\luano\\Zotero\\storage\\KAPVLLSB\\Dong et al. - 2025 - Spatiotemporal characteristics and drivers of global cyber conflicts.pdf', 'C:\\Users\\luano\\Zotero\\storage\\MSTP3MJK\\TD5PT97Q.pdf', 'C:\\Users\\luano\\Zotero\\storage\\99VRUZAP\\Jones - 2025 - Food security and cyber warfare vulnerabilities, implications and resilience-building.pdf', 'C:\\Users\\luano\\Zotero\\storage\\7ZCU665W\\Shandler - 5187 - Cyber conflict & domestic audience costs.pdf', 'C:\\Users\\luano\\Zotero\\storage\\4FT28KIJ\\Leal - 2025 - Blame games in cyberspace how foreign cues shape public opinion on cyber attribution and retributio.pdf', 'C:\\Users\\luano\\Zotero\\storage\\BSWYT548\\Whyte - 2025 - The subversion aversion paradox juxtaposing the tactical and strategic utility of cyber-enabled inf.pdf', 'C:\\Users\\luano\\Zotero\\storage\\BVKDVM6A\\5216954.pdf', 'C:\\Users\\luano\\Zotero\\storage\\XHEFXPZG\\book-part-9781035308514-14.pdf', 'C:\\Users\\luano\\Zotero\\storage\\3A8G854U\\24JKoreanL83.pdf', 'C:\\Users\\luano\\Zotero\\storage\\TMV6IRC5\\Merriman - 2025 - Cyber warfare and state responsibility  exploring accountability in international law.pdf', 'C:\\Users\\luano\\Zotero\\storage\\A4KMJT42\\5249574.pdf', 'C:\\Users\\luano\\Zotero\\storage\\PL98EQNV\\Ying and Shi - 2025 - The chinese restrictive approach to the law on the use of force and its application in cyberspace.pdf', 'C:\\Users\\luano\\Zotero\\storage\\8PTWUENN\\IGBQNFQD.pdf', "C:\\Users\\luano\\Zotero\\storage\\UPUSZZRX\\Neilsen and Pontbriand - 5187 - hands off the keyboard NATO's cyber-defense of civilian critical infrastructure.pdf", 'C:\\Users\\luano\\Zotero\\storage\\KM2FN3Q2\\Hedling and Oerden - 2025 - Disinformation, deterrence and the politics of attribution.pdf', 'C:\\Users\\luano\\Zotero\\storage\\U6CWP57T\\Smedes - 2025 - The increasing prevalence of cyber operations and the inadequacy of international law to address the.pdf', 'C:\\Users\\luano\\Zotero\\storage\\FEJ9RTEX\\Cheng and Li - 2025 - State responsibility in the context of cyberwarfare dilemma identification and path reconstruction.pdf', 'C:\\Users\\luano\\Zotero\\storage\\FS6PF4KE\\Nihreieva - 2025 - State responsibility for cyberattacks as a use of force in the context of the 2022 russian invasion.pdf', "C:\\Users\\luano\\Zotero\\storage\\U3KGJY93\\Serscikov - 2025 - The role of strategic culture in shaping iran's cyber defense policy.pdf", 'C:\\Users\\luano\\Zotero\\storage\\PACZ2MRR\\Stephens - 2025 - Small actors, big disruptions the chaos of shadow strikes in asymmetric cyber warfare.pdf', 'C:\\Users\\luano\\Zotero\\storage\\RHWMFZIE\\JL2UHGBX.pdf', 'C:\\Users\\luano\\Zotero\\storage\\SJ7TGYWN\\Kouloufakos - 2024 - International law attempts to protect critical infrastructures against malicious cyber operations.pdf', 'C:\\Users\\luano\\Zotero\\storage\\QKSUU3TM\\BAH5P8W3.pdf', 'C:\\Users\\luano\\Zotero\\storage\\A6AQT75H\\Alweqyan - 2024 - Cyberattacks in the context of international law enforcement.pdf', 'C:\\Users\\luano\\Zotero\\storage\\U75ELNXY\\Rahman and Das - 2024 - Countering cyberattacks gaps in international law and prospects for overcoming them.pdf', 'C:\\Users\\luano\\Zotero\\storage\\NGXDZG5T\\YHVAWNQ2.pdf', 'C:\\Users\\luano\\Zotero\\storage\\WQ49XKB4\\4976241.pdf', 'C:\\Users\\luano\\Zotero\\storage\\BQW6GGJG\\Baram - 2024 - Cyber diplomacy through official public attribution paving the way for global norms.pdf', 'C:\\Users\\luano\\Zotero\\storage\\PGYYX6V4\\Kulaga - 2024 - Mapping the Position of States on the Application of Sovereignty in Cyberspace.pdf', 'C:\\Users\\luano\\Zotero\\storage\\7U4V7G3B\\Efrony - 2024 - Enhancing accountability in cyberspace through a three-tiered international governance regime.pdf', 'C:\\Users\\luano\\Zotero\\storage\\EUATRQXD\\4999418.pdf', 'C:\\Users\\luano\\Zotero\\storage\\CYV8L5WV\\Royakkers - 2024 - Bytes and battles pathways to de-escalation in the cyber conflict arena.pdf', 'C:\\Users\\luano\\Zotero\\storage\\C3W3M3R4\\GJN5PHZN.pdf', 'C:\\Users\\luano\\Zotero\\storage\\U7GP34TV\\FUL8EHLY.pdf', 'C:\\Users\\luano\\Zotero\\storage\\SL28SMWM\\Kargar and and Rid - 2024 - Attributing digital covert action the curious case of WikiSaudiLeaks.pdf', 'C:\\Users\\luano\\Zotero\\storage\\9R5XDITV\\WNYMAT97.pdf', 'C:\\Users\\luano\\Zotero\\storage\\8Z5LNACI\\Hunter et al. - 2024 - When democracies attack examining the offensive strategies of democracies in cyberspace.pdf', "C:\\Users\\luano\\Zotero\\storage\\5UGG387F\\Kolodii - 2024 - Unpacking russia's cyber-incident response.pdf", 'C:\\Users\\luano\\Zotero\\storage\\Y4IKMXJ8\\Ross - 2024 - Going nuclear the development of american strategic conceptions about cyber conflict.pdf', 'C:\\Users\\luano\\Zotero\\storage\\WRCBD672\\Khalil et al. - 2024 - A new era of armed conflict the role of state and non-state actors in cyber warfare with special re.pdf', 'C:\\Users\\luano\\Zotero\\storage\\JKGWZZA7\\prohibition_of_annexations_and_the_foundations_of_modern_international_law.pdf.pdf', 'C:\\Users\\luano\\Zotero\\storage\\4VEK67R2\\GB643C9M.pdf', "C:\\Users\\luano\\Zotero\\storage\\5THJWTDG\\Giovannelli - 2024 - Handling cyberspace's state of intermediacy through existing international law.pdf", 'C:\\Users\\luano\\Zotero\\storage\\Q9AVTAXC\\Gunatileka - 2024 - “big data breaches”, sovereignty of states and the challenges in attribution.pdf', 'C:\\Users\\luano\\Zotero\\storage\\C7K4QR9R\\Spacil - 2024 - Retorsion An Underrated Retaliatory Measure against Malign Cyber Operations.pdf', 'C:\\Users\\luano\\Zotero\\storage\\3DAQIG8K\\23738871.2024.2436591.pdf', 'C:\\Users\\luano\\Zotero\\storage\\LGC8NTBN\\Gomez and Winger - 5187 - Answering the call why aid allies in cyber conflict.pdf', 'C:\\Users\\luano\\Zotero\\storage\\DGB6E7FX\\div-class-title-state-sponsored-cyber-attacks-and-co-movements-in-stock-market-returns-evidence-from-us-cybersecurity-defense-contractors-div.pdf', 'C:\\Users\\luano\\Zotero\\storage\\QZ6DZN5R\\G3GIESNY.pdf', 'C:\\Users\\luano\\Zotero\\storage\\IIG2Q384\\div-class-title-data-warfare-and-creating-a-global-legal-and-regulatory-landscape-challenges-and-solutions-div.pdf', 'C:\\Users\\luano\\Zotero\\storage\\PNLVDV2K\\Du and Li - 2024 - Legal challenges of attributing malicious cyber activities against space activities.pdf', 'C:\\Users\\luano\\Zotero\\storage\\QM7G8VDZ\\Vostoupal - 2024 - Stuxnet vs WannaCry and Albania cyber - attribution on trial.pdf', 'C:\\Users\\luano\\Zotero\\storage\\5F79G29F\\(Vera Rusinova, Ekaterina Martynova, 2024).pdf', 'C:\\Users\\luano\\Zotero\\storage\\G45WYA5E\\jmae005.pdf', 'C:\\Users\\luano\\Zotero\\storage\\5MYV4X6F\\Williamson - 2024 - Do Proxies Provide Plausible Deniability Evidence from Experiments on Three Surveys.pdf', 'C:\\Users\\luano\\Zotero\\storage\\TIBMM59C\\Lopez - 2024 - Self-help measures against cyber threats in international law special reference to the possible ado.pdf', 'C:\\Users\\luano\\Zotero\\storage\\FDGD7JGH\\Abramson and Baram - 2024 - Saving face in the cyberspace responses to public cyber intrusions in the gulf.pdf', 'C:\\Users\\luano\\Zotero\\storage\\BQGEFM7E\\TI3B6KUX.pdf', 'C:\\Users\\luano\\Zotero\\storage\\ZXSCN3PR\\Bace et al. - 2024 - Law in orbit international legal perspectives on cyberattacks targeting space systems.pdf', 'C:\\Users\\luano\\Zotero\\storage\\QJMRDUNP\\2WuhanUIntlLRev59.pdf', 'C:\\Users\\luano\\Zotero\\storage\\UF4NBHET\\QDZRQNQR.pdf', 'C:\\Users\\luano\\Zotero\\storage\\B7AJQRMK\\Jardine et al. - 2024 - Cyberattacks and public opinion - The effect of uncertainty in guiding preferences.pdf', 'C:\\Users\\luano\\Zotero\\storage\\432YQMES\\Sopilko - 2024 - Strengthening cybersecurity in Ukraine legal frameworks and technical strategies for ensuring cyber.pdf', 'C:\\Users\\luano\\Zotero\\storage\\DZJWKF4X\\(Metodi Hadji-Janev, 2023).pdf', 'C:\\Users\\luano\\Zotero\\storage\\BNAUUU7U\\F96BBUH2.pdf', 'C:\\Users\\luano\\Zotero\\storage\\NHVMK66E\\13600834.2021.2018760.pdf', 'C:\\Users\\luano\\Zotero\\storage\\RSX658HA\\Ogurlu - 2023 - International law in cyberspace an evaluation of the Tallinn manuals.pdf', 'C:\\Users\\luano\\Zotero\\storage\\4MBEJXU3\\Flor - 2023 - Using international law to deter russian proxy hackers.pdf', 'C:\\Users\\luano\\Zotero\\storage\\Z7V8F68H\\XVSZPADD.pdf', 'C:\\Users\\luano\\Zotero\\storage\\KIEVHD6A\\Kryvoi - 2023 - Responding to public and private cyberattacks jurisdiction, self-defence, and countermeasures.pdf', 'C:\\Users\\luano\\Zotero\\storage\\KT5YPVK4\\Turner - 2023 - Network tango examining state dispositions toward attribution in international cyber conflict.pdf', 'C:\\Users\\luano\\Zotero\\storage\\H3SS44SI\\FGS2JBMB.pdf', 'C:\\Users\\luano\\Zotero\\storage\\ZI8UCZ3J\\EIPXQPAX.pdf', 'C:\\Users\\luano\\Zotero\\storage\\VJ94NRGG\\fact-finding-and-cyber-attribution.pdf', 'C:\\Users\\luano\\Zotero\\storage\\26C44MM8\\Poli and Sommario - 2023 - The rationale and the perils of failing to invoke state responsibility for cyber-attacks the case o.pdf', 'C:\\Users\\luano\\Zotero\\storage\\DZTB5GIF\\Burt - 2023 - President Obama and China Cyber Diplomacy and Strategy for a New Era.pdf', 'C:\\Users\\luano\\Zotero\\storage\\IDH6HB9V\\9QK9L72S.pdf', 'C:\\Users\\luano\\Zotero\\storage\\8AZDPJ4D\\8TTNI4DR.pdf', 'C:\\Users\\luano\\Zotero\\storage\\2ID4R3MN\\Yang - 2023 - Pointing with boneless finger and getting away with it the ill-substantiation problem in cyber publ.pdf', 'C:\\Users\\luano\\Zotero\\storage\\BNI8RHDX\\Baram - 2023 - Public secrets the dynamics of publicity and secrecy in offensive cyber operations.pdf', 'C:\\Users\\luano\\Zotero\\storage\\R79MBEA7\\Borghard and Lonergan - 2023 - Deterrence by denial in cyberspace.pdf', 'C:\\Users\\luano\\Zotero\\storage\\62CSLXMS\\Lee - 2023 - Public attribution in the US government implications for diplomacy and norms in cyberspace.pdf', 'C:\\Users\\luano\\Zotero\\storage\\IYSM4QS5\\Maness et al. - 2023 - Expanding the dyadic cyber incident and campaign dataset (DCID) cyber conflict from 2000 to 2020.pdf', "C:\\Users\\luano\\Zotero\\storage\\JS5JGNEN\\Lumiste - 2023 - There and Back Again Russia's Quest for Regulating War in Cyberspace.pdf", 'C:\\Users\\luano\\Zotero\\storage\\IX34V37I\\Michaelsen and Thumfart - 2023 - Drawing a line Digital transnational repression a.pdf', "C:\\Users\\luano\\Zotero\\storage\\BA4VC85N\\Siemion - 2023 - Rethinking US Concepts and Actions in Cyberspace Building a Better Foundation for Deterring China's.pdf", 'C:\\Users\\luano\\Zotero\\storage\\9JIKZ8JK\\Buchanan and Cunningham - 2023 - Preparing the Cyber Battlefield Assessing a Novel Escalation Risk in a Sino-American Crisis.pdf', 'C:\\Users\\luano\\Zotero\\storage\\9QP7MU7H\\article-p3.pdf', 'C:\\Users\\luano\\Zotero\\storage\\CQTVKBSM\\BT4AUHVK.pdf', "C:\\Users\\luano\\Zotero\\storage\\G5D68DQZ\\O'Grady - 2023 - International law and the regulation of cyberoperations below the jus ad bellum threshold. An irish.pdf", 'C:\\Users\\luano\\Zotero\\storage\\YY68V4RS\\Jimoh - 2023 - Critiquing the U.S. characterization, attribution and retaliation laws and policies for cyberattacks.pdf', 'C:\\Users\\luano\\Zotero\\storage\\SEHUMHM5\\(, 2023).pdf', 'C:\\Users\\luano\\Zotero\\storage\\3MJ69JXG\\C2TPMBBF.pdf', 'C:\\Users\\luano\\Zotero\\storage\\PCAIN4XQ\\0067205X231166697.pdf', 'C:\\Users\\luano\\Zotero\\storage\\4TDKV3MS\\WYZ9DEUV.pdf', "C:\\Users\\luano\\Zotero\\storage\\G922R75D\\Lehto - 2023 - Finland's views on international law and cyberspace introduction.pdf", 'C:\\Users\\luano\\Zotero\\storage\\3J4FVPJK\\div-class-title-cyber-intelligence-and-influence-in-defense-of-cyber-manipulation-operations-to-parry-atrocities-div.pdf', "C:\\Users\\luano\\Zotero\\storage\\9HN4CEIG\\Musus - 2023 - Norway's position paper on international law and cyberspace introduction.pdf", 'C:\\Users\\luano\\Zotero\\storage\\AYMCTD6W\\Costea - 2023 - Private-public partnerships in cyber space as deterrence tools. The trans-atlantic view.pdf', 'C:\\Users\\luano\\Zotero\\storage\\3INRP733\\KM8DK8IC.pdf', 'C:\\Users\\luano\\Zotero\\storage\\RFFBZ5IZ\\Harnisch and Zettl-Schabath - 2023 - Secrecy and norm emergence in cyber-space. The US, china and Russia interaction and the governance o.pdf', 'C:\\Users\\luano\\Zotero\\storage\\FVPKRRVP\\Grote - 2023 - Best of both world The interplay between international human rights and the law of armed conflict i.pdf', 'C:\\Users\\luano\\Zotero\\storage\\7VQWMTEI\\TL8H845Y.pdf', 'C:\\Users\\luano\\Zotero\\storage\\B5XE6HJV\\Hansel - 2023 - Great power narratives on the challenges of cyber norm building.pdf', 'C:\\Users\\luano\\Zotero\\storage\\Q37ICKIY\\Mares and Packa - 2023 - Achieving cyber power through integrated government capability factors jeopardizing civil-military.pdf', 'C:\\Users\\luano\\Zotero\\storage\\LLBBXEPX\\Lupovici - 2023 - Deterrence through Inflicting Costs Between Deter.pdf', 'C:\\Users\\luano\\Zotero\\storage\\Q6XC4J4X\\Welburn et al. - 2023 - Cyber deterrence with imperfect attribution and unverifiable signaling.pdf', 'C:\\Users\\luano\\Zotero\\storage\\PHF2BP4S\\DBQU9R27.pdf', 'C:\\Users\\luano\\Zotero\\storage\\MSKUASKA\\Hedgecock and Sukin - 2023 - Responding to uncertainty the importance of covertness in support for retaliation to cyber and kine.pdf', 'C:\\Users\\luano\\Zotero\\storage\\II782S4S\\Egloff et al. - 2023 - Publicly attributing cyber attacks a framework.pdf', 'C:\\Users\\luano\\Zotero\\storage\\UBCLI25S\\Nadibaidze - 2022 - Great power identity in Russia’s position on auton.pdf', 'C:\\Users\\luano\\Zotero\\storage\\DX43THX4\\Devanny et al. - 2022 - Strategy in an Uncertain Domain Threat and Response in Cyberspace.pdf', 'C:\\Users\\luano\\Zotero\\storage\\2EABTSNG\\Stejskal and Faix - 2022 - Legal Aspects of Misattribution Caused by Cyber Deception.pdf', 'C:\\Users\\luano\\Zotero\\storage\\9XQCHID6\\Hoem and Kristiansen - 2022 - Small players in a limitless domain cyber deterrence as small state strategy.pdf', 'C:\\Users\\luano\\Zotero\\storage\\W7GV8M7B\\ssrn_id3986297_code3671000.pdf', 'C:\\Users\\luano\\Zotero\\storage\\Z68WF37I\\5259369.pdf', 'C:\\Users\\luano\\Zotero\\storage\\B8N5UIHR\\0163660X.2022.2054123.pdf', 'C:\\Users\\luano\\Zotero\\storage\\BMZBMTIR\\VLCM76NL.pdf', 'C:\\Users\\luano\\Zotero\\storage\\7QIBK7WR\\PNUMBPFN.pdf', 'C:\\Users\\luano\\Zotero\\storage\\3RHKVEKR\\Kuerbis et al. - 2022 - Understanding transnational cyber attribution moving from whodunit to who did it.pdf', 'C:\\Users\\luano\\Zotero\\storage\\CX5G7XNC\\Moyakine - 2022 - Pulling the strings in cyberspace legal attribution of cyber operations based on state control.pdf', 'C:\\Users\\luano\\Zotero\\storage\\J8E7A5YR\\Kastelic - Non-Escalatory Attribution of International Cyber Incidents.pdf', 'C:\\Users\\luano\\Zotero\\storage\\PCEJ8W48\\Renaud et al. - 2022 - Positioning Diplomacy Within a Strategic Response .pdf', 'C:\\Users\\luano\\Zotero\\storage\\QW6FM6CG\\3MNHW66L.pdf', 'C:\\Users\\luano\\Zotero\\storage\\9M797C2J\\Davis - 2022 - Developing Applicable Standards of Proof for Peacetime Cyber Attribution.pdf', 'C:\\Users\\luano\\Zotero\\storage\\KXAP4LW3\\Yannakogeorgos e Mattice - 2011 - Essential Questions for Cyber Policy Strategically Using Global Norms to Resolve the Cyber Attribut.pdf', 'C:\\Users\\luano\\Zotero\\storage\\NCG9RMS8\\Hollis and Sander - 2022 - International law and cyberspace what does state silence say.pdf', 'C:\\Users\\luano\\Zotero\\storage\\37FP3RNZ\\div-class-title-the-final-frontier-of-cyberspace-the-seabed-beyond-national-jurisdiction-and-the-protection-of-submarine-cables-div.pdf', 'C:\\Users\\luano\\Zotero\\storage\\C9E5CPGH\\contributing-to-cyber-peace-by-maximizing-the-potential-for-deterrence.pdf', 'C:\\Users\\luano\\Zotero\\storage\\9ZA6HYTV\\(Isabella Brunner, 2022).pdf', 'C:\\Users\\luano\\Zotero\\storage\\HBBNEZ27\\Done - 2022 - Applicability of international law in cyberspace positions by Estonia and Latvia.pdf', 'C:\\Users\\luano\\Zotero\\storage\\4GDFI6WK\\Jensen and Watts - Due diligence and defend forward.pdf', 'C:\\Users\\luano\\Zotero\\storage\\ZNEMUVB7\\Leiss - Jus contra bellum in cyberspace and the sound of silence.pdf', 'C:\\Users\\luano\\Zotero\\storage\\IS5BTM5C\\MNK78483.pdf', 'C:\\Users\\luano\\Zotero\\storage\\I7Y3IZ5N\\Osula et al. - 2022 - EU common position on international law and cyberspace.pdf', 'C:\\Users\\luano\\Zotero\\storage\\MWISD73X\\LQZFZW63.pdf', 'C:\\Users\\luano\\Zotero\\storage\\ZVZK7G36\\LQD6HMYI.pdf', 'C:\\Users\\luano\\Zotero\\storage\\84PWNVHA\\Coco et al. - 2022 - Illegal the SolarWinds hack under international law.pdf', 'C:\\Users\\luano\\Zotero\\storage\\GGYR4BLG\\Shrivastava_Lakra_2022_Revisiting due diligence in cyberspace.pdf', 'C:\\Users\\luano\\Zotero\\storage\\359HAXBP\\Lu and Zhang - 2022 - A chinese perspective on public cyber attribution.pdf', 'C:\\Users\\luano\\Zotero\\storage\\CC3F7I57\\Eichensehr - 2022 - Not illegal the solarwinds incident and international law.pdf', 'C:\\Users\\luano\\Zotero\\storage\\2UKPB5HR\\Sun et al. - 2022 - Back to the roots the laws of neutrality and the future of due diligence in cyberspace.pdf', 'C:\\Users\\luano\\Zotero\\storage\\F5EFI333\\Spacil - 2022 - Plea of necessity legal key to protection against unattributable cyber operations.pdf', 'C:\\Users\\luano\\Zotero\\storage\\8EGTFAN3\\Kavaliauskas - 2022 - Can the concept of due diligence contribute to solving the problem of attribution with respect to cy.pdf', 'C:\\Users\\luano\\Zotero\\storage\\4FFALA24\\Haataja - 2022 - Cyber operations against critical infrastructure u.pdf', 'C:\\Users\\luano\\Zotero\\storage\\G5NCEDZR\\Dwan et al. - 2022 - Pirates of the cyber seas are state-sponsored hackers modern-day privateers.pdf', 'C:\\Users\\luano\\Zotero\\storage\\IS55CM5L\\Akoto - 2022 - Accountability and cyber conflict examining institutional constraints on the use of cyber proxies.pdf', 'C:\\Users\\luano\\Zotero\\storage\\QHDPS6HV\\Leal and Musgrave - 2022 - Cheerleading in cyberspace how the american public judges attribution claims for cyberattacks.pdf', 'C:\\Users\\luano\\Zotero\\storage\\YT8YRPLC\\Canfil and Canfil - 2022 - The illogic of plausible deniability why proxy conflict in cyberspace may no longer pay.pdf', 'C:\\Users\\luano\\Zotero\\storage\\L2DV9X5S\\Liebetrau - 2022 - Cyber conflict short of war a european strategic vacuum.pdf', 'C:\\Users\\luano\\Zotero\\storage\\R95ICDVC\\Broeders et al. - 2022 - Revisiting past cyber operations in light of new cyber norms and interpretations of international la.pdf', 'C:\\Users\\luano\\Zotero\\storage\\SLSYCYY5\\(CD Westphal, 2021).pdf', 'C:\\Users\\luano\\Zotero\\storage\\ST25QSJZ\\(Taís Fernanda Blauth, Dr Oskar J Gstrein, 2021).pdf', 'C:\\Users\\luano\\Zotero\\storage\\IBLTZHFS\\Hoverd - 2021 - Cyber threat attribution, trust and confidence, and the contestability of national security policy.pdf', 'C:\\Users\\luano\\Zotero\\storage\\MQQ6BME5\\VCP74I7C.pdf', 'C:\\Users\\luano\\Zotero\\storage\\HHLYGW2V\\Styple - 2021 - Institutional doxing and attribution  searching for solutions to a law-free zone.pdf', 'C:\\Users\\luano\\Zotero\\storage\\VXDSME4L\\Arimatsu et al. - 2021 - The plea of necessity an oft overlooked response option for hostile cyber operations.pdf', 'C:\\Users\\luano\\Zotero\\storage\\8NEPBGXJ\\ssrn_id3962163_code1636539.pdf', 'C:\\Users\\luano\\Zotero\\storage\\LJJ6ILJJ\\(V Greiman, 2021).pdf', 'C:\\Users\\luano\\Zotero\\storage\\GD4JEXDK\\KTLCNE2P.pdf', 'C:\\Users\\luano\\Zotero\\storage\\B8HXL78Y\\ProQuestDocuments-2025-07-08.pdf', 'C:\\Users\\luano\\Zotero\\storage\\8F44G63I\\Eichensehr - 2021 - Cyberattack attribution as empowerment and constraint.pdf', 'C:\\Users\\luano\\Zotero\\storage\\J2PN87QK\\AX3R73NM.pdf', 'C:\\Users\\luano\\Zotero\\storage\\IXF3AS6F\\unacknowledged-operations.pdf', 'C:\\Users\\luano\\Zotero\\storage\\EASXCJRP\\8JP7SKHR.pdf', 'C:\\Users\\luano\\Zotero\\storage\\UXZPWG8S\\5XACV5PG.pdf', 'C:\\Users\\luano\\Zotero\\storage\\9ITFF92E\\Tallinn_Papers_Attribution_18082021.pdf', 'C:\\Users\\luano\\Zotero\\storage\\D47IU3M6\\Romanosky and Boudreaux - 2021 - Private-sector attribution of cyber incidents benefits and risks to the U.S. government.pdf', "C:\\Users\\luano\\Zotero\\storage\\ULJHDCHC\\Jiang - 2021 - Decoding china's perspectives on cyber warfare.pdf", 'C:\\Users\\luano\\Zotero\\storage\\BTURKZNN\\Aravindakshan - 2021 - Reflections on information influence operations as illegal intervention.pdf', 'C:\\Users\\luano\\Zotero\\storage\\ERR65JSK\\QWWWJG7F.pdf', 'C:\\Users\\luano\\Zotero\\storage\\ALSS2443\\Johnson and Schmitt - 2021 - Responding to proxy cyber operations under international law.pdf', 'C:\\Users\\luano\\Zotero\\storage\\U8PKQ284\\(Annegret Bendiek, Matthias Schulze, 2021).pdf', 'C:\\Users\\luano\\Zotero\\storage\\S5HPWAXC\\64J5DBZX.pdf', 'C:\\Users\\luano\\Zotero\\storage\\D47ADE3K\\Carter - Mapping a Path to Cyber Attribution Consensus.pdf', 'C:\\Users\\luano\\Zotero\\storage\\RMLNAJQX\\Bronk and Watling - 2021 - I. The slow and imprecise art of cyber warfare.pdf', 'C:\\Users\\luano\\Zotero\\storage\\MMXYI7VJ\\Eichensehr - 2021 - United states joins with allies, including nato, to attribute malicious cyber activities to China.pdf', 'C:\\Users\\luano\\Zotero\\storage\\DD9WHB96\\Hunter et al. - 2021 - Factors That Motivate State-Sponsored Cyberattacks.pdf', 'C:\\Users\\luano\\Zotero\\storage\\7VF2939S\\Soesanto and Smeets - 2021 - Cyber Deterrence The Past, Present, and Future.pdf', "C:\\Users\\luano\\Zotero\\storage\\FQ8YINWB\\Prieto - 2021 - Virtually defenseless america's struggle to defend itself in cyberspace and what can Be done about.pdf", 'C:\\Users\\luano\\Zotero\\storage\\V3BS47AK\\3JMNTC3D.pdf', 'C:\\Users\\luano\\Zotero\\storage\\S78F4MIY\\Trahan - 2021 - The criminalization of cyber-operations under the rome statute.pdf', 'C:\\Users\\luano\\Zotero\\storage\\4R2DQ4FK\\Hedgecock - 2021 - Strategic Attribution Target State Communications in Response to Cyber Operations.pdf', 'C:\\Users\\luano\\Zotero\\storage\\FLSX9PCP\\Bowman - Securing the precipitous heights U.S. lawfare as a means to confront china at sea, in space, and cy.pdf', 'C:\\Users\\luano\\Zotero\\storage\\NFP8IX79\\Orji - 2021 - Interrogating african positions on state sponsored cyber operations a review of regional and nation.pdf', 'C:\\Users\\luano\\Zotero\\storage\\FZUGF74D\\Karim - 2021 - Cybersecurity and cyber diplomacy at the crossroad an appraisal of evolving international legal dev.pdf', 'C:\\Users\\luano\\Zotero\\storage\\G7UZ644H\\SDCNTLIS.pdf', 'C:\\Users\\luano\\Zotero\\storage\\UQHS5WB9\\J6RVYGY5.pdf', 'C:\\Users\\luano\\Zotero\\storage\\X836CZ24\\9YA6QDCU.pdf', 'C:\\Users\\luano\\Zotero\\storage\\8UKU4YH5\\Geiss and Lahmann - 2021 - Protecting societies anchoring a new protection dimension In international law In times of increase.pdf', 'C:\\Users\\luano\\Zotero\\storage\\SGPTJQAG\\RL7CIYPG.pdf', 'C:\\Users\\luano\\Zotero\\storage\\JNIUXSRB\\Moynihan - 2021 - The vital role of international law in the framework for responsible state behaviour in cyberspace.pdf', 'C:\\Users\\luano\\Zotero\\storage\\TXQ4LMGV\\Eoyang and Keitner - 2021 - Cybercrime vs. Cyberwar paradigms for addressing malicious cyber activity.pdf', 'C:\\Users\\luano\\Zotero\\storage\\E4JSM9VC\\DN2JVA53.pdf', 'C:\\Users\\luano\\Zotero\\storage\\82IX52XI\\ACC7HMIK.pdf', 'C:\\Users\\luano\\Zotero\\storage\\47P68ECQ\\V4MDI2UW.pdf', 'C:\\Users\\luano\\Zotero\\storage\\D23R4N82\\Lonergan and Montgomery - 2021 - What is the future of cyber deterrence.pdf', 'C:\\Users\\luano\\Zotero\\storage\\M9FS39VV\\(Y Shany, T Mimran, 2021).pdf', 'C:\\Users\\luano\\Zotero\\storage\\HX67UX9A\\[Indian Journal of International Law 2020-aug 17] Aravindakshan, Sharngan - Cyberattacks_ a look at evidentiary thresholds in International Law (2020) [10.1007_s40901-020-00113-0] - libgen.li.pdf', 'C:\\Users\\luano\\Zotero\\storage\\9HWAH2DG\\Poetranto et al. - 2021 - Look south challenges and opportunities for the ‘rules of the road’ for cyberspace in ASEAN and the.pdf', 'C:\\Users\\luano\\Zotero\\storage\\LYLFQZS4\\Ciglic and and Hering - 2021 - A multi-stakeholder foundation for peace in cyberspace.pdf', 'C:\\Users\\luano\\Zotero\\storage\\NCG25JSN\\10.1080_14799855.2021.1896495.pdf', 'C:\\Users\\luano\\Zotero\\storage\\JA3THCZQ\\(W Banks, 2021).pdf', 'C:\\Users\\luano\\Zotero\\storage\\USCR66RW\\WWB8FYLM.pdf', 'C:\\Users\\luano\\Zotero\\storage\\2P8WTWEJ\\TTWFXCVM.pdf', 'C:\\Users\\luano\\Zotero\\storage\\7ZV9RGQV\\9IVGVKRB.pdf', 'C:\\Users\\luano\\Zotero\\storage\\U2EC57JF\\Lupovici - 2021 - The Dog That Did Not Bark, the Dog That Did Bark, .pdf', 'C:\\Users\\luano\\Zotero\\storage\\M4XM7GFA\\8FYM5N5E.pdf', 'C:\\Users\\luano\\Zotero\\storage\\6SHW8NFQ\\Douzet and and Gery - 2021 - Cyberspace is used, first and foremost, to wage wars proliferation, security and stability in cyber.pdf', 'C:\\Users\\luano\\Zotero\\storage\\FV7UQ84S\\Lilli - 2021 - Redefining deterrence in cyberspace private sector contribution to national strategies of cyber det.pdf', 'C:\\Users\\luano\\Zotero\\storage\\8HHILB7U\\Brown and Fazal - 2021 - #SorryNotSorry why states neither confirm nor deny responsibility for cyber operations.pdf', "C:\\Users\\luano\\Zotero\\storage\\T4IRCWJV\\Coco and Dias - 2021 - 'Cyber Due Diligence' A Patchwork of Protective Obligations in International Law.pdf", 'C:\\Users\\luano\\Zotero\\storage\\4ALCTATC\\Kostyuk - 2021 - Deterrence in the cyber realm public versus private cyber capacity.pdf', 'C:\\Users\\luano\\Zotero\\storage\\Y556PFU7\\Bobrowski - 2021 - Conventional attack vs digital attack in the light of international law.pdf', 'C:\\Users\\luano\\Zotero\\storage\\4W65GHM8\\Egloff and Cavelty - 2021 - Attribution and knowledge creation assemblages in cybersecurity politics.pdf', 'C:\\Users\\luano\\Zotero\\storage\\ZMLR9BT7\\Lindsay - 2021 - Cyber conflict vs. Cyber command hidden dangers in the american military solution to a large-scale.pdf', 'C:\\Users\\luano\\Zotero\\storage\\EGZM233Z\\Q9T5XCPB.pdf', 'C:\\Users\\luano\\Zotero\\storage\\QH6BZ5WG\\WIJUSXWQ.pdf', 'C:\\Users\\luano\\Zotero\\storage\\2H8H9DLZ\\Libicki - 2020 - Cyberwar is What States Make of It.pdf', 'C:\\Users\\luano\\Zotero\\storage\\X4V4C2VU\\Brantly - 2020 - Entanglement in cyberspace minding the deterrence gap.pdf', 'C:\\Users\\luano\\Zotero\\storage\\ADTTSCQG\\64L88YW3.pdf', 'C:\\Users\\luano\\Zotero\\storage\\RWBTGEGA\\ssrn_id3770816_code3850815.pdf', 'C:\\Users\\luano\\Zotero\\storage\\BC2DBEUN\\4I36KRQK.pdf', 'C:\\Users\\luano\\Zotero\\storage\\3RVAPNPA\\Bergwik - 2020 - Due diligence in cyberspace an assessment of rule 6 in the Tallinn manual 2.0.pdf', 'C:\\Users\\luano\\Zotero\\storage\\9CV93KFD\\V388FEEB.pdf', 'C:\\Users\\luano\\Zotero\\storage\\449MZF4Z\\00396338.2020.1715071.pdf', 'C:\\Users\\luano\\Zotero\\storage\\IVYACB5R\\Mendes - 2020 - The problem of cyber - attribution and how it matters for international law and global security.pdf', 'C:\\Users\\luano\\Zotero\\storage\\CF82VE3Z\\state-responsibility-and-the-consequences-of-an-internationally-wrongful-cyber-operation.pdf', 'C:\\Users\\luano\\Zotero\\storage\\DA2MX2V3\\9IWF6BG2.pdf', 'C:\\Users\\luano\\Zotero\\storage\\EF6QKQFP\\InstitutionalisingCyberAttribution.pdf', 'C:\\Users\\luano\\Zotero\\storage\\4PBTDMEU\\the-question-of-evidence-from-technical-to-legal-attribution.pdf', 'C:\\Users\\luano\\Zotero\\storage\\LXV445HW\\Hinck and Maurer - 2020 - Persistent enforcement criminal charges as a response to nation-state malicious cyber activity.pdf', 'C:\\Users\\luano\\Zotero\\storage\\PDWGVEBM\\Olovson - 2020 - Hacking for the state the use of private persons in cyber attacks and state responsibility.pdf', 'C:\\Users\\luano\\Zotero\\storage\\R9JY8KKM\\Blagden - 2020 - Deterring cyber coercion the exaggerated problem of attribution.pdf', 'C:\\Users\\luano\\Zotero\\storage\\LEFUBTPE\\Braw and Brown - 2020 - Personalised deterrence of cyber aggression.pdf', 'C:\\Users\\luano\\Zotero\\storage\\G23L96FG\\Broeders et al. - 2020 - Three tales of attribution in cyberspace criminal law, international law and policy debates.pdf', 'C:\\Users\\luano\\Zotero\\storage\\9LUVSGM7\\Delerue - 2020 - Cyber operations and the principle of due diligence.pdf', 'C:\\Users\\luano\\Zotero\\storage\\EH99IMFV\\RGSGEU4F.pdf', 'C:\\Users\\luano\\Zotero\\storage\\AURGCWN3\\election-interference-is-not-cyber-war.pdf', 'C:\\Users\\luano\\Zotero\\storage\\QRV3ITUS\\RD9BVGFE.pdf', 'C:\\Users\\luano\\Zotero\\storage\\XWSBLFDE\\Wilner - 2020 - US cyber deterrence practice guiding theory.pdf', 'C:\\Users\\luano\\Zotero\\storage\\V7U5TQMS\\Yau - 2020 - Evolving toward a balanced cyber strategy in east Asia cyber deterrence or cooperation.pdf', 'C:\\Users\\luano\\Zotero\\storage\\HB7772FV\\V4PCGAXE.pdf', 'C:\\Users\\luano\\Zotero\\storage\\UF2B5MAX\\KBF7RF2X.pdf', 'C:\\Users\\luano\\Zotero\\storage\\KKZ6E7ZU\\ssrn_id3712264_code1687971.pdf', 'C:\\Users\\luano\\Zotero\\storage\\7ZP8LCLW\\Kalpokiene and Kalpokas - 2020 - Contemplating a cyber weapons convention an exploration of good practice and necessary precondition.pdf', 'C:\\Users\\luano\\Zotero\\storage\\29KYPV6Y\\Gill - 2020 - The changing role of multilateral forums in regulating armed conflict in the digital age.pdf', 'C:\\Users\\luano\\Zotero\\storage\\VU54JZQ2\\Finnemore et al. - 2020 - Beyond naming and shaming accusations and international law in cybersecurity.pdf', 'C:\\Users\\luano\\Zotero\\storage\\9IJ8FIYV\\Bentley - 2020 - The inadequacy of international law to address cyber-attacks in the age of election-meddling.pdf', 'C:\\Users\\luano\\Zotero\\storage\\I8FCUR9B\\YC8AZ2N5.pdf', 'C:\\Users\\luano\\Zotero\\storage\\3ET6JDXT\\Moulin - 2020 - Reviving the principle of non-intervention in cyberspace the path forward.pdf', 'C:\\Users\\luano\\Zotero\\storage\\EESGXCKM\\8MJW96I5.pdf', 'C:\\Users\\luano\\Zotero\\storage\\39A88DZJ\\Goel - 2020 - How improved attribution in cyber warfare can help de-escalate cyber arms race.pdf', 'C:\\Users\\luano\\Zotero\\storage\\LF6XANQ9\\Huang and Ying - 2020 - The application of the principle of distinction in the cyber context a chinese perspective.pdf', 'C:\\Users\\luano\\Zotero\\storage\\7FURVU3H\\B6DD3S6A.pdf', 'C:\\Users\\luano\\Zotero\\storage\\BRV2AQNH\\Grotto - 2020 - Deconstructing cyber attribution a proposed framework and lexicon.pdf', 'C:\\Users\\luano\\Zotero\\storage\\VIEBJQX5\\EDRBZPWK.pdf', 'C:\\Users\\luano\\Zotero\\storage\\2SKNXIKR\\(S Haataja, 2020).pdf', 'C:\\Users\\luano\\Zotero\\storage\\P3DV26AN\\Thumfart - 2020 - Public and private just wars distributed cyber deterrence based on vitoria and grotius.pdf', 'C:\\Users\\luano\\Zotero\\storage\\9224LCF2\\Krishnamurthy - 2020 - Cyber-attacks in outer space a study.pdf', 'C:\\Users\\luano\\Zotero\\storage\\X93ASRNE\\SXEQP8DX.pdf', 'C:\\Users\\luano\\Zotero\\storage\\VCRDXKUD\\Whyte - 2020 - Beyond tit-for-tat in cyberspace political warfare and lateral sources of escalation online.pdf', 'C:\\Users\\luano\\Zotero\\storage\\GMJ49DID\\(Justin Key Canfil, 2020).pdf', 'C:\\Users\\luano\\Zotero\\storage\\IAR9KP2Y\\Milanovic and Schmitt - 2020 - Cyber attacks and cyber (mis)information operations during a pandemic.pdf', 'C:\\Users\\luano\\Zotero\\storage\\4PPV5ZIE\\PXUUQSYY.pdf', 'C:\\Users\\luano\\Zotero\\storage\\RMNSN53Z\\Tsagourias and Farrell - 2020 - Cyber attribution technical and legal approaches and challenges.pdf', 'C:\\Users\\luano\\Zotero\\storage\\Y2WGZPCI\\Whyte - 2020 - Cyber conflict or democracy “hacked” How cyber operations enhance information warfare.pdf', 'C:\\Users\\luano\\Zotero\\storage\\UXFM9FEG\\Maurer - 2020 - A dose of realism the contestation and politics of cyber norms.pdf', 'C:\\Users\\luano\\Zotero\\storage\\5RZPSEMP\\Egloff - 2020 - Contested public attributions of cyber incidents and the role of academia.pdf', 'C:\\Users\\luano\\Zotero\\storage\\4H5TNBPL\\Egloff and Egloff - 2020 - Public attribution of cyber intrusions.pdf', 'C:\\Users\\luano\\Zotero\\storage\\TABB22B4\\(Major Patrick Leblanc, 2019).pdf', 'C:\\Users\\luano\\Zotero\\storage\\3WLSSXXM\\Mueller et al. - 2019 - Cyber attribution can a new institution achieve transnational credibility.pdf', 'C:\\Users\\luano\\Zotero\\storage\\MRV366MP\\ssrn_id3793013_code3640433.pdf', 'C:\\Users\\luano\\Zotero\\storage\\ZN2WUE4K\\W3C25H39.pdf', 'C:\\Users\\luano\\Zotero\\storage\\4ADWMUSC\\P8MZ2SLR.pdf', 'C:\\Users\\luano\\Zotero\\storage\\TXITK3CD\\commentary-on-the-law-of-cyber-operations-and-the-dod-law-of-war-manual.pdf', 'C:\\Users\\luano\\Zotero\\storage\\9ZK4P5JF\\Bannelier et al. - 2019 - MULTIPLE MOONS Cyber sanctions and the role of the private sector.pdf', 'C:\\Users\\luano\\Zotero\\storage\\X7WN2JJI\\Tehrani - 2019 - Cyber Resilience Strategy and Attribution in the Context of International law.pdf', 'C:\\Users\\luano\\Zotero\\storage\\NACYNRR7\\(AG Hill, 2019).pdf', 'C:\\Users\\luano\\Zotero\\storage\\ANQ4USFU\\2Y6P7WB3.pdf', 'C:\\Users\\luano\\Zotero\\storage\\K56NV2CZ\\J6V79T5P.pdf', 'C:\\Users\\luano\\Zotero\\storage\\GZDNRNAV\\Verhelst - 2019 - Cybersecurity and international law  a closer look at recent UN and EU initiatives.pdf', 'C:\\Users\\luano\\Zotero\\storage\\3TDBCI5N\\van Niekerk and Ramluckan - 2019 - Economic Information Warfare Feasibility and Lega.pdf', 'C:\\Users\\luano\\Zotero\\storage\\SFZJZQB4\\B5FFDB4Q.pdf', 'C:\\Users\\luano\\Zotero\\storage\\NEYPIJWM\\(Karine Bannelieret al, 2019).pdf', 'C:\\Users\\luano\\Zotero\\storage\\DVACIX65\\7KNDEV8F.pdf', 'C:\\Users\\luano\\Zotero\\storage\\KNBMWHJ2\\Delerue - 2019 - Attribution to State of Cyber Operations Conducted by Non-State Actors.pdf', 'C:\\Users\\luano\\Zotero\\storage\\QEZVAE7A\\WFR2Y7FX.pdf', 'C:\\Users\\luano\\Zotero\\storage\\7FW8PUIJ\\GNTEAFVK.pdf', 'C:\\Users\\luano\\Zotero\\storage\\DNCGZP5A\\WBIJQYQJ.pdf', 'C:\\Users\\luano\\Zotero\\storage\\S5EV8ZHQ\\L4PXZS27.pdf', 'C:\\Users\\luano\\Zotero\\storage\\TBBTDB7I\\Dederer and Singer - 2019 - Adverse Cyber Operations Causality, Attribution, .pdf', 'C:\\Users\\luano\\Zotero\\storage\\X485738N\\Zilincik et al. - 2019 - Cyber power and control a perspective from strategic theory.pdf', 'C:\\Users\\luano\\Zotero\\storage\\ZKJ2FQJ6\\QV47NQ33.pdf', 'C:\\Users\\luano\\Zotero\\storage\\VITJ5DDH\\10.23919_cycon.2019.8757141.pdf', 'C:\\Users\\luano\\Zotero\\storage\\275MULYI\\(K Hartmannet al, 2019).pdf', 'C:\\Users\\luano\\Zotero\\storage\\SM27LBGY\\Taillat - 2019 - Disrupt and restraint the evolution of cyber conflict and the implications for collective security.pdf', 'C:\\Users\\luano\\Zotero\\storage\\Z73E4XRG\\(MA Gomez, 2019).pdf', 'C:\\Users\\luano\\Zotero\\storage\\ADV4SJXL\\Baram and Sommer - 2019 - Covert or not covert national strategies during cyber conflict.pdf', 'C:\\Users\\luano\\Zotero\\storage\\CUHK3TGA\\Sander - 2019 - Democracy Under The Influence Paradigms of State Responsibility for Cyber Influence Operations on E.pdf', 'C:\\Users\\luano\\Zotero\\storage\\RJHJU8VR\\9FYZBM4S.pdf', 'C:\\Users\\luano\\Zotero\\storage\\J7NXUN7T\\Gomez - 2019 - Sound the alarm! Updating beliefs and degradative .pdf', 'C:\\Users\\luano\\Zotero\\storage\\TIQN8PFG\\23738871.2019.1701693.pdf', 'C:\\Users\\luano\\Zotero\\storage\\PLFJFG5R\\Kostyuk and Zhukov - 2019 - Invisible digital front can cyber attacks shape battlefield events.pdf', 'C:\\Users\\luano\\Zotero\\storage\\8MYLAPTM\\Tran - 2018 - The Law of Attribution Rules for Attribution the Source of a Cyber-Attack Note.pdf', 'C:\\Users\\luano\\Zotero\\storage\\7U93KB98\\(W Banks, 2018).pdf', 'C:\\Users\\luano\\Zotero\\storage\\8YRK5RZF\\Tolga - Principles of Cyber Deterrence and the Challenges in Developing a Credible Cyber Deterrence Posture.pdf', 'C:\\Users\\luano\\Zotero\\storage\\Y7MY295G\\(Lucie Kadlecová, 2018).pdf', 'C:\\Users\\luano\\Zotero\\storage\\WBTIVM4E\\viewcontent.cgi.pdf', 'C:\\Users\\luano\\Zotero\\storage\\BHBX48LE\\Lefebvre - 2018 - Cracking attribution  moving international norms forward.pdf', 'C:\\Users\\luano\\Zotero\\storage\\C6SG966A\\RCFHU8Y8.pdf', 'C:\\Users\\luano\\Zotero\\storage\\IYHJ3EYD\\Schmitt - THE LAW OF CYBER WARFARE.pdf', 'C:\\Users\\luano\\Zotero\\storage\\SRSXF7CA\\Lotrionte - 2018 - Reconsidering the Consequences for State-Sponsored Hostile Cyber Operations Under International Law.pdf', 'C:\\Users\\luano\\Zotero\\storage\\67VR4UJ5\\(B Kuerbiset al, 2018).pdf', 'C:\\Users\\luano\\Zotero\\storage\\H6K5BDZ9\\7LRDA3NY.pdf', 'C:\\Users\\luano\\Zotero\\storage\\7JVHAEGI\\Taddeo - 2018 - The limits of deterrence theory in cyberspace.pdf', 'C:\\Users\\luano\\Zotero\\storage\\MXUSKKIT\\(Thomas Reinholdet al, 2018).pdf', 'C:\\Users\\luano\\Zotero\\storage\\E56TWVW7\\Burton - Cyber Deterrence A Comprehensive Approach.pdf', 'C:\\Users\\luano\\Zotero\\storage\\5WQ4PCB2\\Finnemore and Hollis - 2018 - Naming without shaming Accuzations and international law in global cybersecurity.”.pdf', 'C:\\Users\\luano\\Zotero\\storage\\VW4TVFBF\\Schulzke - 2018 - The politics of attributing blame for cyberattacks and the costs of uncertainty.pdf', 'C:\\Users\\luano\\Zotero\\storage\\M34Z4A4M\\ssrn_id3256666_code2418133.pdf', 'C:\\Users\\luano\\Zotero\\storage\\9C6G84ZM\\QNXUQSEG.pdf', 'C:\\Users\\luano\\Zotero\\storage\\AQKNCN8E\\Nyabuto - 2018 - A game of code challenges of cyberspace as a domain of warfare.pdf', 'C:\\Users\\luano\\Zotero\\storage\\L7VV4N63\\Cook - 2018 - Cross-border data access and active cyber defense Assessing legislative options for a new internati.pdf', 'C:\\Users\\luano\\Zotero\\storage\\9P8GFMK2\\Chircop - 2018 - A DUE DILIGENCE STANDARD OF ATTRIBUTION IN CYBERSPACE.pdf', 'C:\\Users\\luano\\Zotero\\storage\\PSWSBSS9\\Schmitt - 2018 - Virtual Disenfranchisement Cyber Election Meddling in the Grey Zones of International Law.pdf', 'C:\\Users\\luano\\Zotero\\storage\\J5ANVN29\\Brantly - 2018 - The cyber deterrence problem.pdf', 'C:\\Users\\luano\\Zotero\\storage\\ZL7835UD\\Poznansky and Perkoski - 2018 - Rethinking secrecy in cyberspace the politics of voluntary attribution.pdf', 'C:\\Users\\luano\\Zotero\\storage\\G9TGPERZ\\10.1093_ejil_chy071.pdf', 'C:\\Users\\luano\\Zotero\\storage\\2SCRSVZP\\JVRG9M6B.pdf', 'C:\\Users\\luano\\Zotero\\storage\\QLZR6EEJ\\Tanyildizi - 2017 - State responsibility in cyberspace the problem of attribution of cyberattacks conducted by non-stat.pdf', 'C:\\Users\\luano\\Zotero\\storage\\X5JBVTTF\\Kittichaisaree - 2017 - Future prospects of public international law of cyberspace.pdf', 'C:\\Users\\luano\\Zotero\\storage\\ZBADK7KG\\AETR2JUT.pdf', 'C:\\Users\\luano\\Zotero\\storage\\USKK4VLD\\Davis et al. - 2017 - Stateless attribution toward international accountability in cyberspace.pdf', 'C:\\Users\\luano\\Zotero\\storage\\852FVSDP\\Stockburger - 2017 - The control & capabilities test How a new legal regime is shaping attribution in cyberspace.pdf', 'C:\\Users\\luano\\Zotero\\storage\\4PNPTXKH\\U6DF4B74.pdf', 'C:\\Users\\luano\\Zotero\\storage\\JIJJWW8D\\8XPLITQJ.pdf', 'C:\\Users\\luano\\Zotero\\storage\\ITA9T458\\(Hidemi Suganamiet al, 2017).pdf', 'C:\\Users\\luano\\Zotero\\storage\\4ZS3E8NG\\main.pdf', 'C:\\Users\\luano\\Zotero\\storage\\NGN8S6DA\\BKVEKFS8.pdf', 'C:\\Users\\luano\\Zotero\\storage\\AKCWQN2P\\GS8TNTUF.pdf', 'C:\\Users\\luano\\Zotero\\storage\\T2USX8B8\\UEELS534.pdf', 'C:\\Users\\luano\\Zotero\\storage\\BZKGKLR6\\(Ian Yuying Liu, Ian Yuying Liu, 2017).pdf', 'C:\\Users\\luano\\Zotero\\storage\\XSHAZYVI\\Baradaran and Habibi - 2017 - Cyber Warfare and Self - Defense from the Perspective of International Law.pdf', 'C:\\Users\\luano\\Zotero\\storage\\M5CEIUFH\\8BLRFXCZ.pdf', 'C:\\Users\\luano\\Zotero\\storage\\CPJLL28H\\(Peter Z. Stockburger, Peter Z. Stockburger, 2017).pdf', 'C:\\Users\\luano\\Zotero\\storage\\6DJWEN97\\I8XAL7B7.pdf', 'C:\\Users\\luano\\Zotero\\storage\\EGZ3TNAS\\(Christian Payne, Lorraine Finlay, 2017).pdf', 'C:\\Users\\luano\\Zotero\\storage\\65PGBJV6\\23UXFS4N.pdf', 'C:\\Users\\luano\\Zotero\\storage\\TN3I49T8\\RPGYA5D6.pdf', 'C:\\Users\\luano\\Zotero\\storage\\4TNW8W6J\\Banks.pdf', 'C:\\Users\\luano\\Zotero\\storage\\JZFBBHEQ\\BQKGXE9S.pdf', 'C:\\Users\\luano\\Zotero\\storage\\D6FHJXM4\\(Thomas Payne, 2016).pdf', 'C:\\Users\\luano\\Zotero\\storage\\N9P3C34F\\(Priyanka R. Dev, 2015).pdf', 'C:\\Users\\luano\\Zotero\\storage\\E3IYCJGT\\2016_MSFT_Cybersecurity_Norms_vFinal.pdf', 'C:\\Users\\luano\\Zotero\\storage\\6TTMF4HB\\ssrn_id2809828_code2291099.pdf', 'C:\\Users\\luano\\Zotero\\storage\\CKXV9IG3\\PNN272MD.pdf', 'C:\\Users\\luano\\Zotero\\storage\\HZPEBAWX\\Watts - Cyber Norm Development and the United States Law of War Manual.pdf', 'C:\\Users\\luano\\Zotero\\storage\\7AXA7CYV\\Brantly - 2016 - Defining the Role of Intelligence in Cyberspace.pdf', 'C:\\Users\\luano\\Zotero\\storage\\ELEJRCYW\\(Aaron Franklin Brantly, William W. Keller, Scott A. Jones, 2016).pdf', 'C:\\Users\\luano\\Zotero\\storage\\V4EQSF55\\(Herbert Lin, 2016).pdf', 'C:\\Users\\luano\\Zotero\\storage\\PE3E8HRP\\UNSVBH4H.pdf', 'C:\\Users\\luano\\Zotero\\storage\\KGBB4K7W\\XUBKQ3AX.pdf', 'C:\\Users\\luano\\Zotero\\storage\\9VZXJUSU\\NTUET9XJ.pdf', "C:\\Users\\luano\\Zotero\\storage\\V6W25S7P\\d'Aspremont - 2016 - Cyber Operations and International Law An Interventionist Legal Thought.pdf", 'C:\\Users\\luano\\Zotero\\storage\\XB5VK994\\SZX5ZFZR.pdf', 'C:\\Users\\luano\\Zotero\\storage\\QVWL78W7\\Brantly - 2016 - The most governed ungoverned space legal and policy constraints on military operations in cyberspac.pdf', 'C:\\Users\\luano\\Zotero\\storage\\LB6B2D2F\\Maurer - 2016 - Proxies and cyberspace.pdf', 'C:\\Users\\luano\\Zotero\\storage\\76ZRR68W\\2UQEJDV9.pdf', 'C:\\Users\\luano\\Zotero\\storage\\DESLNL49\\Stockburger - 2016 - KNOWN UNKNOWNS STATE CYBER OPERATIONS, CYBER WARF.pdf', 'C:\\Users\\luano\\Zotero\\storage\\9ELZFVCT\\Shackelford and Russell - 2015 - Operationalizing Cybersecurity Due Diligence A Tr.pdf', 'C:\\Users\\luano\\Zotero\\storage\\NDPMN2K9\\Schmitt et al. - 2016 - Beyond state-centrism international law and non-state actors in cyberspace.pdf', 'C:\\Users\\luano\\Zotero\\storage\\4GMLJQWW\\Schmitt_2015_In Defense of Due Diligence in Cyberspace.pdf', "C:\\Users\\luano\\Zotero\\storage\\P4N94GML\\Macák - 2016 - Decoding Article 8 of the International Law Commission's Articles on State Responsibility Attributi.pdf", 'C:\\Users\\luano\\Zotero\\storage\\FT8GB4DF\\Buchan - 2016 - Cyberspace, non-state actors and the obligation to prevent transboundary harm.pdf', 'C:\\Users\\luano\\Zotero\\storage\\AJM7LAB6\\(A Lupovici, 2016).pdf', 'C:\\Users\\luano\\Zotero\\storage\\27STTT38\\FI45IHWH.pdf', 'C:\\Users\\luano\\Zotero\\storage\\DH4CXZJQ\\PETZPV7M.pdf', 'C:\\Users\\luano\\Zotero\\storage\\IKX9U9B5\\Bradshaw et al. - 2015 - Rule making for state conduct in the attribution of cyber attacks.pdf', 'C:\\Users\\luano\\Zotero\\storage\\EMN5XI8H\\MCKGE6GE.pdf', 'C:\\Users\\luano\\Zotero\\storage\\Q95G65KK\\G2JMAAXE.pdf', 'C:\\Users\\luano\\Zotero\\storage\\ML6ZPXYS\\Brunnee and Meshel - 2015 - Teaching an old law new tricks international environmental law lessons for cyberspace governance.pdf', 'C:\\Users\\luano\\Zotero\\storage\\BTWTATHA\\ssrn_id2734419_code2091508.pdf', 'C:\\Users\\luano\\Zotero\\storage\\RW9T288J\\522FKXG7.pdf', 'C:\\Users\\luano\\Zotero\\storage\\GNED8YH6\\(A Bendiek, T Metzger, 2015).pdf', "C:\\Users\\luano\\Zotero\\storage\\U4YV8KXZ\\Burton - 2015 - NATO's cyber defence strategic challenges and institutional adaptation.pdf", 'C:\\Users\\luano\\Zotero\\storage\\W2U3WHU9\\J9G2U8UR.pdf', 'C:\\Users\\luano\\Zotero\\storage\\4CQS3SJI\\H4LCQ9GF.pdf', 'C:\\Users\\luano\\Zotero\\storage\\8F66RMG9\\FNLMK9YC.pdf', 'C:\\Users\\luano\\Zotero\\storage\\R4NXUTUH\\E572CT4J.pdf', 'C:\\Users\\luano\\Zotero\\storage\\QA54EXSD\\ssrn_id2593868_code1689451.pdf', 'C:\\Users\\luano\\Zotero\\storage\\5II3ZVWR\\Y8F4CS6U.pdf', 'C:\\Users\\luano\\Zotero\\storage\\P9J6F97F\\XFPCE7YP.pdf', 'C:\\Users\\luano\\Zotero\\storage\\AFX5T7NL\\Simmons - 2014 - A Brave New World Applying International Law of War to Cyber-Attacks.pdf', 'C:\\Users\\luano\\Zotero\\storage\\8FZNCNRT\\HKUI3UUL.pdf', 'C:\\Users\\luano\\Zotero\\storage\\G25T89CM\\D6NK3C6C.pdf', 'C:\\Users\\luano\\Zotero\\storage\\P9XULYTS\\(Constantine Antonopoulos, Constantine Antonopoulos, 2015).pdf', 'C:\\Users\\luano\\Zotero\\storage\\NZ5B2NJN\\875523XM.pdf', 'C:\\Users\\luano\\Zotero\\storage\\AI39U8GB\\Henriksen - 2015 - Lawful State Responses to Low-Level Cyber-Attacks.pdf', 'C:\\Users\\luano\\Zotero\\storage\\USBCBC6G\\van der Meer - 2015 - Enhancing international cyber security.pdf', 'C:\\Users\\luano\\Zotero\\storage\\99BZ6RLH\\Rivera - 2015 - Achieving cyberdeterrence and the ability of small states to hold large states at risk.pdf', 'C:\\Users\\luano\\Zotero\\storage\\FN7M6IDE\\2CLCXLGC.pdf', 'C:\\Users\\luano\\Zotero\\storage\\A93SXJXF\\10.4337_9781782547396.00018.pdf', 'C:\\Users\\luano\\Zotero\\storage\\4ZCFHXZR\\H8HADWAZ.pdf', 'C:\\Users\\luano\\Zotero\\storage\\5WN99HMI\\Shackelford et al. - 2015 - Unpacking the International Law on Cybersecurity Due Diligence Lessons from the Public and Private.pdf', 'C:\\Users\\luano\\Zotero\\storage\\PC77HX8N\\(Marco Roscini, Marco Roscini, 2015).pdf', 'C:\\Users\\luano\\Zotero\\storage\\RYKJ4KWM\\Lindsay - 2015 - Tipping the scales the attribution problem and the feasibility of deterrence against cyberattack.pdf', 'C:\\Users\\luano\\Zotero\\storage\\AZN6P3JU\\(T Rid, B Buchanan, 2015).pdf', 'C:\\Users\\luano\\Zotero\\storage\\Y5799FTK\\Schmitt and Vihul - 2014 - The nature of international law cyber norms.pdf', 'C:\\Users\\luano\\Zotero\\storage\\9GWBWECJ\\Mejia and Framework - 2014 - Act and actor attribution in cyberspace a proposed analytic framework.pdf', 'C:\\Users\\luano\\Zotero\\storage\\34RLRYKB\\Geiss and Lahmann - 2014 - Freedom and security in cyberspace shifting the focus away from military responses towards non-forc.pdf', 'C:\\Users\\luano\\Zotero\\storage\\2RTCIZNG\\Schmitt and Vihul - 2014 - Proxy wars in cyberspace the evolving international law of attribution policy.pdf', 'C:\\Users\\luano\\Zotero\\storage\\ZITNK5HV\\WGC5LU23.pdf', 'C:\\Users\\luano\\Zotero\\storage\\D6BRXXJW\\PLBY6MLI.pdf', 'C:\\Users\\luano\\Zotero\\storage\\79SCFQ9Z\\Healey et al. - 2014 - Confidence-building measures in cyberspace.pdf', 'C:\\Users\\luano\\Zotero\\storage\\BSB6AKSX\\Valeriano and Maness - 2014 - The dynamics of cyber conflict between rival antagonists, 2001-11.pdf', 'C:\\Users\\luano\\Zotero\\storage\\ZZDQ9NNC\\JJF7D6TB.pdf', 'C:\\Users\\luano\\Zotero\\storage\\55UG3WK4\\N4DB92C3.pdf', 'C:\\Users\\luano\\Zotero\\storage\\KZRI5IJ9\\9EESWTEB.pdf', 'C:\\Users\\luano\\Zotero\\storage\\4QEWRNRI\\SBM8MRLC.pdf', 'C:\\Users\\luano\\Zotero\\storage\\X68C5LSU\\Lucas - 2014 - Ethics and cyber conflict a response to JME 121 (2013).pdf', 'C:\\Users\\luano\\Zotero\\storage\\8WZUBPIP\\03071847.2014.895264.pdf', 'C:\\Users\\luano\\Zotero\\storage\\2XSQ2RHD\\G3XGGFGV.pdf', 'C:\\Users\\luano\\Zotero\\storage\\DGTMNX8X\\FRXPAZU5.pdf', 'C:\\Users\\luano\\Zotero\\storage\\GH2JRNA6\\Roscini - 2014 - Cyber operations as nuclear counterproliferation measures.pdf', 'C:\\Users\\luano\\Zotero\\storage\\4KQ2BT2W\\XVFULTHJ.pdf', 'C:\\Users\\luano\\Zotero\\storage\\JZFR537G\\5AYIJM8U.pdf', 'C:\\Users\\luano\\Zotero\\storage\\24NZ6WBN\\Johnson - 2014 - Anti-social networking crowdsourcing and the cyber defence of national critical infrastructures.pdf', 'C:\\Users\\luano\\Zotero\\storage\\RSJUKS7S\\Geopolitics+and+Cyber+Power_3A+Why+Geography+Still+Matters.pdf', 'C:\\Users\\luano\\Zotero\\storage\\7ZU7W79K\\Iasiello - 2014 - Is cyber deterrence an illusory course of action.pdf', 'C:\\Users\\luano\\Zotero\\storage\\LGB85JTH\\Nguyen - 2013 - Navigating Jus Ad Bellum in the Age of Cyber Warfare.pdf', 'C:\\Users\\luano\\Zotero\\storage\\R55RNBDG\\RCWTG8Q4.pdf', 'C:\\Users\\luano\\Zotero\\storage\\TVQR8CB9\\GZMIHZSQ.pdf', 'C:\\Users\\luano\\Zotero\\storage\\D4EPUSTX\\F59PP7IQ.pdf', 'C:\\Users\\luano\\Zotero\\storage\\B5WMEVBH\\34VMJIMJ.pdf', 'C:\\Users\\luano\\Zotero\\storage\\HWJKV38N\\T5LE96UX.pdf', 'C:\\Users\\luano\\Zotero\\storage\\44HR5X9Z\\viewcontent.cgi.pdf', 'C:\\Users\\luano\\Zotero\\storage\\Q55X6C7V\\(Yoram Dinstein, Fania Domb, Laurie R. Blank, 2013).pdf', 'C:\\Users\\luano\\Zotero\\storage\\EN9HGKWC\\viewcontent.cgi.pdf', 'C:\\Users\\luano\\Zotero\\storage\\Q3WFRPH5\\Guitton and and Korzak - 2013 - The Sophistication Criterion for Attribution Identifying the Perpetrators of Cyber-Attacks.pdf', 'C:\\Users\\luano\\Zotero\\storage\\ZX43QZLK\\Iasiello - 2013 - Cyber attack a dull tool to shape foreign policy.pdf', 'C:\\Users\\luano\\Zotero\\storage\\24CLLSPP\\Sigholm - 2013 - Non-state actors in cyberspace operations.pdf', 'C:\\Users\\luano\\Zotero\\storage\\IXRGJPF9\\UE52YCCT.pdf', 'C:\\Users\\luano\\Zotero\\storage\\FRE3DRUN\\V2DDH444.pdf', 'C:\\Users\\luano\\Zotero\\storage\\8BKPMUKJ\\4UJBH88S.pdf', 'C:\\Users\\luano\\Zotero\\storage\\MU2LZIIG\\Fidler et al. - 2013 - NATO, cyber defense, and international law.pdf', 'C:\\Users\\luano\\Zotero\\storage\\59Q74PU4\\ssrn_id2351590_code2153015.pdf', 'C:\\Users\\luano\\Zotero\\storage\\CHDMIBPR\\YGWXNVBX.pdf', 'C:\\Users\\luano\\Zotero\\storage\\VTAZDCKQ\\9RB38IT6.pdf', 'C:\\Users\\luano\\Zotero\\storage\\Q6N2HWHB\\N4N4HUIT.pdf', 'C:\\Users\\luano\\Zotero\\storage\\BHJKRERB\\UY34U6AF.pdf', 'C:\\Users\\luano\\Zotero\\storage\\CBSMQQXB\\Kessler and Werner - 2013 - Expertise, uncertainty, and international law a study of the Tallinn manual on cyberwarfare.pdf', 'C:\\Users\\luano\\Zotero\\storage\\JCKBBC7S\\KU7SNJPJ.pdf', 'C:\\Users\\luano\\Zotero\\storage\\X9YWAL6Y\\Waxman - Self-Defensive Force Against Cyber Attacks Legal, Strategic and Political Dimensions.pdf', 'C:\\Users\\luano\\Zotero\\storage\\76NGPBX8\\2U24UV2X.pdf', 'C:\\Users\\luano\\Zotero\\storage\\9LFQBMNT\\(Terry D. Gill, Paul AL Ducheine, 2013).pdf', 'C:\\Users\\luano\\Zotero\\storage\\SFRTBDAR\\ILHEA8XF.pdf', 'C:\\Users\\luano\\Zotero\\storage\\STSZBP76\\DNLJ4CZY.pdf', 'C:\\Users\\luano\\Zotero\\storage\\4Y4UAPYJ\\Saltzman - 2013 - Cyber posturing and the offense-defense balance.pdf', 'C:\\Users\\luano\\Zotero\\storage\\VS2BDFTH\\Harrison Dinniss - 2012 - Computer network attacks as a use of force in international law.pdf', 'C:\\Users\\luano\\Zotero\\storage\\TLDPQXCR\\Brecher - 2012 - Cyberattacks and the Covert Action Statute Toward a Domestic Legal Framework for Offensive Cyberope.pdf', 'C:\\Users\\luano\\Zotero\\storage\\L2LXU8SZ\\Hare - 2012 - The signifi cance of attribution to cyberspace coercion A political perspective.pdf', 'C:\\Users\\luano\\Zotero\\storage\\HA7AW48H\\ssrn_id2312039_code2107120.pdf', 'C:\\Users\\luano\\Zotero\\storage\\A59ACXZX\\Harrison Dinniss - 2012 - Armed attack and response in the digital age.pdf', 'C:\\Users\\luano\\Zotero\\storage\\VN7ML3EU\\Castel - 2012 - International and canadian law rules applicable to cyber attacks by state and non-state actors.pdf', 'C:\\Users\\luano\\Zotero\\storage\\DTQ7AHV8\\3LZES3GD.pdf', 'C:\\Users\\luano\\Zotero\\storage\\LZWDBFQX\\(Jason Healey, 2012).pdf', 'C:\\Users\\luano\\Zotero\\storage\\DF6QEH39\\8BS9QPCG.pdf', 'C:\\Users\\luano\\Zotero\\storage\\PMBW5QQ7\\G3Y2E42Y.pdf', 'C:\\Users\\luano\\Zotero\\storage\\QCCZ9WP3\\36HIVBBV.pdf', 'C:\\Users\\luano\\Zotero\\storage\\JPWG6PVT\\CN5FKS4Z.pdf', 'C:\\Users\\luano\\Zotero\\storage\\TDS8BHD5\\MN8W6UW5.pdf', 'C:\\Users\\luano\\Zotero\\storage\\87P7H55I\\MDKDA8HZ.pdf', 'C:\\Users\\luano\\Zotero\\storage\\6AC8UNWK\\NZV97JVD.pdf', 'C:\\Users\\luano\\Zotero\\storage\\B38J9B2F\\ABLDRC5D.pdf', 'C:\\Users\\luano\\Zotero\\storage\\3RKB6HUX\\DSMZEC52.pdf', 'C:\\Users\\luano\\Zotero\\storage\\5G8TDHJW\\HA6R6G3S.pdf', 'C:\\Users\\luano\\Zotero\\storage\\M6X4PUTB\\Lin - 2012 - Cyber conflict and international humanitarian law.pdf', 'C:\\Users\\luano\\Zotero\\storage\\LMACY3DS\\Buchan - 2012 - Cyber attacks unlawful uses of force or prohibited interventions.pdf', 'C:\\Users\\luano\\Zotero\\storage\\CJEQWCLW\\Stevens - 2012 - A Cyberwar of Ideas Deterrence and Norms in Cyberspace.pdf', 'C:\\Users\\luano\\Zotero\\storage\\BQWJWAXP\\Tsagourias - 2012 - Cyber attacks, self-defence and the problem of attribution.pdf', "C:\\Users\\luano\\Zotero\\storage\\EKHVCESF\\O'Connell - 2012 - Cyber security without cyber war.pdf", 'C:\\Users\\luano\\Zotero\\storage\\WPHNAFZS\\10.1080_19445571.2011.636956.pdf', 'C:\\Users\\luano\\Zotero\\storage\\GAQX5LSP\\(Katharine C Hinkle, 2011).pdf', 'C:\\Users\\luano\\Zotero\\storage\\4IF2RM9S\\ssrn_id1800924_code1349730.pdf', 'C:\\Users\\luano\\Zotero\\storage\\WP7V88GH\\68PI67HF.pdf', 'C:\\Users\\luano\\Zotero\\storage\\BXBAM6UW\\Shackelford et al. - 2011 - State responsibility for cyber attacks competing standards for a growing problem.pdf', 'C:\\Users\\luano\\Zotero\\storage\\PGNDKI3W\\ssrn_id1928870_code427934.pdf', "C:\\Users\\luano\\Zotero\\storage\\V8US5VD4\\(Nikhil D'Souza, Nikhil D'Souza, 2011).pdf", 'C:\\Users\\luano\\Zotero\\storage\\AGRGSX9P\\PDPIGILK.pdf', 'C:\\Users\\luano\\Zotero\\storage\\RSAT6ITF\\Schmitt - 2011 - Cyber operations and the jud ad bellum revisited.pdf', 'C:\\Users\\luano\\Zotero\\storage\\848TDD2N\\Schmitt - 2011 - Cyber operations and the jus in bello key issues.pdf', 'C:\\Users\\luano\\Zotero\\storage\\IW2VLL2E\\Waxman - 2011 - Cyber-attacks and the use of force back to the future of article 2(4).pdf', 'C:\\Users\\luano\\Zotero\\storage\\N663BFIA\\(Michael N Schmitt, ).pdf', 'C:\\Users\\luano\\Zotero\\storage\\KTQSP4IL\\Reich et al. - 2010 - Cyber warfare a review of theories, law, policies, actual incidents -- and the dilemma of anonymity.pdf', 'C:\\Users\\luano\\Zotero\\storage\\2U96QSAU\\Libicki - 2010 - Pulling Punches in Cyberspace.pdf', 'C:\\Users\\luano\\Zotero\\storage\\8IUG8AT9\\Ottis - 2010 - From pitchforks to laptops volunteers in cyber conflicts.pdf', 'C:\\Users\\luano\\Zotero\\storage\\DGL5UXA3\\(Sean Kanuck, 2009).pdf', 'C:\\Users\\luano\\Zotero\\storage\\D49TVXJN\\Earl Boebert - A Survey of Challenges in Attribution.pdf', 'C:\\Users\\luano\\Zotero\\storage\\DK4AQT5B\\_.pdf', 'C:\\Users\\luano\\Zotero\\storage\\BWEMFB5Z\\LFMAW5LQ.pdf', 'C:\\Users\\luano\\Zotero\\storage\\PJU948YM\\Knake - 2010 - Untangling attribution moving to accountability in cyberspace.pdf', 'C:\\Users\\luano\\Zotero\\storage\\Z94797ZI\\Goodman - 2010 - Cyber Deterrence Tougher in Theory than in Practice.pdf', 'C:\\Users\\luano\\Zotero\\storage\\SFJ6BQI8\\Rowe - 2010 - The ethics of cyberweapons in warfare.pdf', 'C:\\Users\\luano\\Zotero\\storage\\NC8QFI9F\\2010 - .pdf', 'C:\\Users\\luano\\Zotero\\storage\\8Y329NED\\(Herbert S. Lin, 2010).pdf', 'C:\\Users\\luano\\Zotero\\storage\\Z3V6VFXW\\6MEA6HTW.pdf', 'C:\\Users\\luano\\Zotero\\storage\\HI3IFGAM\\TMANA99R.pdf', 'C:\\Users\\luano\\Zotero\\storage\\E9I4IG8V\\ssrn_id1651905_code500200.pdf', 'C:\\Users\\luano\\Zotero\\storage\\5GPG5C4R\\YPZ7C3CB.pdf', 'C:\\Users\\luano\\Zotero\\storage\\AZEMZSHR\\PZVALH97.pdf', 'C:\\Users\\luano\\Zotero\\storage\\5J2E9THG\\Clark DD - 2010 - Untangling attribution..pdf', 'C:\\Users\\luano\\Zotero\\storage\\EK2HFFX7\\H5YJTMV4.pdf', 'C:\\Users\\luano\\Zotero\\storage\\6JPPM9SY\\Roscini - 2010 - World wide warfare - jus ad bellum and the use of cyber force.pdf', 'C:\\Users\\luano\\Zotero\\storage\\XTHLGU23\\(Graham H. Todd, 2009).pdf', 'C:\\Users\\luano\\Zotero\\storage\\WE3BQFRH\\KZLR9EC7.pdf', 'C:\\Users\\luano\\Zotero\\storage\\F92R2GEY\\(Matthew Hoisington, 2009).pdf', 'C:\\Users\\luano\\Zotero\\storage\\NTSKPQZC\\S4V5WX2Z.pdf', 'C:\\Users\\luano\\Zotero\\storage\\KXCAVVDI\\Franzese - 2009 - Sovereignty in cyberspace can it exist.pdf', 'C:\\Users\\luano\\Zotero\\storage\\8KBJI8DG\\FL7BQXNA.pdf', 'C:\\Users\\luano\\Zotero\\storage\\8IJNH37U\\I2RU2RL3.pdf', 'C:\\Users\\luano\\Zotero\\storage\\AAUAG97F\\viewcontent.cgi.pdf', 'C:\\Users\\luano\\Zotero\\storage\\7Y8JFCM6\\Dinstein - Computer Network Attacks and Self-Defense.pdf', 'C:\\Users\\luano\\Zotero\\storage\\8CPFBC2H\\MFRGQXGQ.pdf', 'C:\\Users\\luano\\Zotero\\storage\\RSKMD4PI\\FLF7MXN7.pdf']
#
api_key = os.environ["MISTRAL_API_KEY"]
#
# result = submit_mistral_ocr3_batch(
#     pdf_paths=pdfs,
#     api_key=api_key,
# )

# print(result)

from pathlib import Path
from typing import Union, Optional, List, Dict, Any
from pypdf import PdfReader
MISTRAL_REFERENCES_SCHEMA = {
    "schema": {
        "title": "DocumentCitationMentions",
        "type": "object",
        "properties": {
            "references": {
                "type": "array",
                "description": (
                    "Evidence-first citation mentions. Copy what is printed; do not infer bibliographic metadata."
                ),
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "mention_id": {
                            "type": "string",
                            "description": (
                                "Stable identifier for this mention within the returned payload. "
                                "Format: 'm' + digits (e.g., 'm1', 'm2')."
                            ),
                            "pattern": "^m[0-9]+$",
                            "minLength": 2,
                            "maxLength": 24,
                        },
                        "citation_type": {
                            "type": "string",
                            "enum": ["in_text", "footnote", "unknown"],
                            "description": "How the citation appears in the main document text.",
                        },
                        "citation_anchor": {
                            "type": "string",
                            "description": (
                                "Exact citation token as printed at the anchor point. "
                                "For in-text: include surrounding parentheses/brackets if present. "
                                "For footnotes: the exact marker as printed near the anchor (e.g., '19' or '19.'). "
                                "Do not split or rewrite. Do not invent."
                            ),
                            "minLength": 1,
                            "maxLength": 160,
                        },
                        "context_preceding": {
                            "type": "string",
                            "description": (
                                "Exact preceding text only. Capture up to the last 80 characters immediately BEFORE "
                                "the citation_anchor begins. Exclude the citation itself and following text. "
                                "Preserve whitespace and punctuation."
                            ),
                            "minLength": 0,
                            "maxLength": 80,
                        },
                        "raw": {
                            "type": "string",
                            "description": (
                                "If footnote-based: full footnote text for this marker as printed. "
                                "If in-text: the in-text citation string as printed. "
                                "If uncertain: store the most direct printed citation string. Do not invent."
                            ),
                            "minLength": 1,
                            "maxLength": 2500,
                        },
                        "footnote_number": {
                            "type": ["integer", "null"],
                            "description": (
                                "Footnote marker number as integer when citation_type='footnote'. "
                                "If the marker is not a pure number or is unknown, use null."
                            ),
                            "minimum": 1,
                        },
                    },
                    "required": [
                        "mention_id",
                        "citation_type",
                        "citation_anchor",
                        "context_preceding",
                        "raw",
                        "footnote_number",
                    ],
                },
            }
        },
        "required": ["references"],
        "additionalProperties": False,
    },
    "name": "document_annotation",
    "strict": False,
}

# MISTRAL_REFERENCES_SCHEMA = {
#     "schema": {
#         "title": "DocumentReferences",
#         "type": "object",
#         "properties": {
#             "references": {
#                 "type": "array",
#                 "items": {
#                     "type": "object",
#                     "properties": {
#                         "citation_type": {
#                             "type": "string",
#                             "enum": ["in_text", "footnote", "unknown"],
#                             "description": "How the citation appears in the main document text.",
#                         },
#                         "citation_anchor": {
#                             "type": "string",
#                             "description": (
#                                 "Exact citation token as seen in the main text. "
#                                 "Examples: '(Author 2020)', '(Author, 2020: 13)' "
#                                 "or a footnote marker such as digits which must match intext like preceeding text +digit/.digit/,digit "
#                                 "and in the footnote area digit +bibliographic info/comment '19'/'19.' as printed in the text. "
#                                 "If multiple citations appear in one anchor (e.g., '(Author, 2020; Author2, 2019)') "
#                                 "or multiple works appear in one footnote, split them individually. "
#                                 "Do not invent."
#                             ),
#                             "minLength": 0,
#                             "maxLength": 120,
#                         },
#                         "context_preceding": {
#                             "type": "string",
#                             "description": (
#                                 "Exact preceding text only. Capture up to the last 80 characters immediately BEFORE "
#                                 "the citation_anchor begins (the '(' for in-text citations, or the first digit of the footnote marker). "
#                                 "Exclude the citation itself and any following text. Preserve whitespace and punctuation."
#                             ),
#                             "minLength": 0,
#                             "maxLength": 80,
#                         },
#                         "author": {
#                             "type": "string",
#                             "description": (
#                                 "Best-effort author as used for identification. "
#                                 "For persons, prefer surname. For institutions, use the institution name (e.g., 'ICJ'). "
#                                 "Do not include surrounding prose. Do not invent."
#                             ),
#                             "minLength": 0,
#                             "maxLength": 200,
#                         },
#                         "year": {
#                             "type": "string",
#                             "description": (
#                                 "Prefer a 4-digit year when present; otherwise keep the year text as printed "
#                                 "(e.g., '2020', 'n.d.'). Do not invent."
#                             ),
#                             "minLength": 0,
#                             "maxLength": 40,
#                         },
#                         "title": {
#                             "type": "string",
#                             "description": (
#                                 "Best-effort work title as printed (article/book/report/webpage title). "
#                                 "Prefer the title present in the footnote text or nearby bibliography-like text. "
#                                 "Do not invent."
#                             ),
#                             "minLength": 0,
#                             "maxLength": 500,
#                         },
#                         "doi": {
#                             "type": "string",
#                             "description": (
#                                 "DOI as printed (e.g., '10.1234/abcd.12345'). "
#                                 "If absent, return empty string. Do not invent."
#                             ),
#                             "minLength": 0,
#                             "maxLength": 200,
#                         },
#                         "url": {
#                             "type": "string",
#                             "description": (
#                                 "URL as printed for the cited work (prefer stable/explicit URLs). "
#                                 "If absent, return empty string. Do not invent."
#                             ),
#                             "minLength": 0,
#                             "maxLength": 500,
#                         },
#                         "raw": {
#                             "type": "string",
#                             "description": (
#                                 "If footnote-based: store the full footnote text as printed. "
#                                 "If in-text: store the in-text citation string as printed (not the bibliography entry). "
#                                 "If uncertain, store the most direct printed citation string."
#                             ),
#                             "minLength": 0,
#                             "maxLength": 2000,
#                         },
#                         "footnote_number": {
#                             "type": ["integer", "null"],
#                             "description": "Footnote marker number as integer when citation_type='footnote'; otherwise null.",
#                         },
#                         "page_index": {
#                             "type": ["integer", "null"],
#                             "description": "0-based page index where citation_anchor appears; null if unknown.",
#                         },
#                     },
#                     "required": [
#                         "citation_type",
#                         "citation_anchor",
#                         "context_preceding",
#                         "author",
#                         "year",
#                         "title",
#                         "doi",
#                         "url",
#                         "raw",
#                     ],
#                     "additionalProperties": True,
#                 },
#             }
#         },
#         "required": ["references"],
#         "additionalProperties": True,
#     },
#     "name": "document_annotation",
#     "strict": False,
# }



def ocr_single_pdf_structured(
    pdf_path: Union[str, Path],
    model: str = "mistral-ocr-latest",
    pages: Optional[List[int]] = None,
    max_pages_per_request: int = 8,
    cache_root: Optional[Union[str, Path]] = None,
) -> Dict[str, Any]:
    """
    ###1. resolve per-file cache path from pdf_path
    ###2. if cache exists and contains structured_references.references, return it
    ###3. otherwise OCR and write/update the same cache file (append missing keys)
    """
    pdf_path = Path(pdf_path).expanduser().resolve()

    home = Path.home()
    base = Path(cache_root) if cache_root else (home / "annotarium" / "cache" / "mistral")
    files_dir = base / "files"
    base.mkdir(parents=True, exist_ok=True)
    files_dir.mkdir(parents=True, exist_ok=True)

    def _canon(p: str) -> str:
        x = os.path.normpath(p)
        return os.path.normcase(x)

    canon_path = _canon(str(pdf_path))
    h = hashlib.sha256(canon_path.encode()).hexdigest()
    fcache = files_dir / f"{h}.json"
    print(fcache)

    if fcache.is_file():
        cached = json.loads(fcache.read_text(encoding="utf-8"))
        sr = cached.get("structured_references")
        refs = (sr or {}).get("references") if isinstance(sr, dict) else None
        if isinstance(refs, list):
            md = cached.get("markdown") or ""
            return {"markdown": md, "structured_references": sr}

    client = Mistral(api_key=api_key)
    logging.getLogger("pypdf").setLevel(logging.ERROR)

    reader = PdfReader(str(pdf_path), strict=False)
    total_pages = len(reader.pages)

    if pages is None:
        target_pages = list(range(total_pages))
    else:
        target_pages = sorted({int(p) for p in pages if 0 <= int(p) < total_pages})

    if max_pages_per_request < 1:
        max_pages_per_request = 1

    with pdf_path.open("rb") as fh:
        upload_res = client.files.upload(
            file={"file_name": pdf_path.name, "content": fh},
            purpose="ocr",
        )

    signed_url = client.files.get_signed_url(file_id=upload_res.id).url

    def chunk_list(xs: List[int], n: int) -> List[List[int]]:
        return [xs[i : i + n] for i in range(0, len(xs), n)]

    markdown_parts: List[str] = []
    merged_refs: List[Dict[str, Any]] = []
    annotation_errors: List[Dict[str, Any]] = []

    for chunk in chunk_list(target_pages, max_pages_per_request):
        body = {
            "model": model,
            "document": {"type": "document_url", "document_url": signed_url},
            "pages": chunk,
            "document_annotation_format": {
                "type": "json_schema",
                "json_schema": MISTRAL_REFERENCES_SCHEMA,
            },
        }

        result = client.ocr.process(**body)

        result_obj = result
        result_dict = result_obj if isinstance(result_obj, dict) else (
            result_obj.__dict__ if getattr(type(result_obj), "__dict__", None) is not None else {})

        pages_out = result_dict.get("pages") or []
        for page in pages_out:
            page_dict = page if isinstance(page, dict) else (
                page.__dict__ if getattr(type(page), "__dict__", None) is not None else {})
            md = page_dict.get("markdown")
            if md:
                markdown_parts.append(md)

        ann_raw = result_dict.get("document_annotation")
        if ann_raw:
            structured = json.loads(ann_raw)
            refs = structured.get("references", [])
            if isinstance(refs, list):
                merged_refs.extend(refs)
            else:
                annotation_errors.append({"error": "annotation_references_not_list", "raw": structured, "pages": chunk})

    def _to_int_or_none(x: Any) -> Optional[int]:
        if x is None:
            return None
        s = str(x).strip()
        if not s:
            return None
        if s.isdigit():
            return int(s)
        return None

    cleaned_refs: List[Dict[str, Any]] = []
    for r in merged_refs:
        if not isinstance(r, dict):
            continue
        rr = dict(r)
        rr.pop("index", None)
        rr["footnote_number"] = _to_int_or_none(rr.get("footnote_number"))
        cleaned_refs.append(rr)

    structured_out: Dict[str, Any] = {"references": cleaned_refs}
    if annotation_errors:
        structured_out["annotation_errors"] = annotation_errors

    md_out = "\n\n".join(markdown_parts)
    new_payload = {
        "pdf_path": str(pdf_path),
        "markdown": md_out,
        "structured_references": structured_out,
        "model": model,
        "pages": pages or None,
    }

    if fcache.is_file():
        existing = json.loads(fcache.read_text(encoding="utf-8"))
        merged = dict(existing)
        if "markdown" not in merged:
            merged["markdown"] = md_out
        if "structured_references" not in merged:
            merged["structured_references"] = structured_out
        if isinstance(merged.get("structured_references"), dict):
            if "references" not in merged["structured_references"]:
                merged["structured_references"]["references"] = cleaned_refs
        if "pdf_path" not in merged:
            merged["pdf_path"] = str(pdf_path)
        if "model" not in merged:
            merged["model"] = model
        if "pages" not in merged:
            merged["pages"] = pages or None
        fcache.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
        return {"markdown": merged.get("markdown") or "", "structured_references": merged.get("structured_references")}

    fcache.write_text(json.dumps(new_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"markdown": md_out, "structured_references": structured_out}


from pathlib import Path
from typing import Union, Dict, Any
import os
import time
import tempfile
import ssl
import certifi
import httpx
from mistralai import Mistral

def mistral_batch_references(df) -> Dict[str, Any]:
    """
    ###1. derive pdf paths + per-row metadata from df
    ###2. use per-file cache; if structured_references.references is non-empty, keep; else queue for batch
    ###3. upload queued pdfs, create JSONL batch for /v1/ocr with document_annotation_format
    ###4. poll job, parse JSONL output, then write/update per-file cache (fill missing/empty refs; never overwrite non-empty)
    ###5. return processed entries including metadata
    """
    model = "mistral-ocr-latest"
    pages = None
    metadata_job = {}

    home = Path.home()
    base = home / "annotarium" / "cache" / "mistral"
    files_dir = base / "files"
    base.mkdir(parents=True, exist_ok=True)
    files_dir.mkdir(parents=True, exist_ok=True)

    def _canon(p: str) -> str:
        x = os.path.normpath(p)
        return os.path.normcase(x)

    def _per_file_cache_path(pdf_path_str: str) -> Path:
        h = hashlib.sha256(_canon(pdf_path_str).encode()).hexdigest()
        return files_dir / f"{h}.json"

    def _nonempty_refs(refs: Any) -> List[Dict[str, Any]]:
        xs = refs if isinstance(refs, list) else []
        out: List[Dict[str, Any]] = []
        for r in xs:
            if not isinstance(r, dict):
                continue
            if any(str(v).strip() for v in r.values() if v is not None):
                out.append(r)
        return out

    def _has_references(payload: Dict[str, Any]) -> bool:
        sr = payload.get("structured_references")
        if not isinstance(sr, dict):
            return False
        return len(_nonempty_refs(sr.get("references"))) > 0

    def _extract_markdown_and_refs(rec: Dict[str, Any]) -> Dict[str, Any]:
        """
        ###1. normalise record shape (batch JSONL vs direct body)
        ###2. collect pages[*].markdown
        ###3. parse document_annotation JSON string into structured_references.references
        """
        body: Any = rec

        resp = rec.get("response")
        if isinstance(resp, dict):
            resp_body = resp.get("body")
            body = resp_body if isinstance(resp_body, dict) else resp

        if isinstance(rec.get("body"), dict) and not isinstance(body, dict):
            body = rec["body"]

        pages_out = body.get("pages") if isinstance(body, dict) else []
        pages_out = pages_out if isinstance(pages_out, list) else []

        md_parts: List[str] = []
        for p in pages_out:
            if isinstance(p, dict):
                md = p.get("markdown")
                if isinstance(md, str) and md.strip():
                    md_parts.append(md)

        ann_raw = body.get("document_annotation") if isinstance(body, dict) else None

        refs_payload: Dict[str, Any] = {"references": []}
        if isinstance(ann_raw, str) and ann_raw.strip():
            parsed = json.loads(ann_raw)
            refs = parsed.get("references")
            refs_payload["references"] = refs if isinstance(refs, list) else []
            if not isinstance(refs, list):
                refs_payload["annotation_errors"] = [{"error": "annotation_references_not_list", "raw": parsed}]

        return {"markdown": "\n\n".join(md_parts), "structured_references": refs_payload}

    rows = df.to_dict(orient="records")
    pdf_to_meta: Dict[str, Dict[str, Any]] = {}
    pdf_list: List[Path] = []

    for row in rows:
        p_raw = row.get("pdf_path")
        if not isinstance(p_raw, str) or not p_raw.strip():
            continue
        p = Path(p_raw).expanduser().resolve()
        p_str = str(p)
        pdf_list.append(p)
        if p_str not in pdf_to_meta:
            pdf_to_meta[p_str] = {
                "title": row.get("title"),
                "authors": row.get("authors"),
                "year": row.get("year"),
                "url": row.get("url"),
                "source": row.get("source"),
                "item_type": row.get("item_type"),
                "abstract": row.get("abstract"),
                "doi": row.get("doi"),
                "pdf_path": p_str,
            }

    pdf_set = sorted({str(p) for p in pdf_list})

    params = {"model": model, "pages": pages, "files": pdf_set, "purpose": "references"}
    set_key = hashlib.sha256(json.dumps(params, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    set_cache_path = base / f"{set_key}.json"

    if set_cache_path.is_file():
        return json.loads(set_cache_path.read_text(encoding="utf-8"))

    cached_entries: List[Dict[str, Any]] = []
    to_upload: List[str] = []

    for p in pdf_set:
        fcache = _per_file_cache_path(p)
        if fcache.is_file():
            payload = json.loads(fcache.read_text(encoding="utf-8"))
            if "metadata" not in payload and p in pdf_to_meta:
                payload["metadata"] = pdf_to_meta[p]
                fcache.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            if _has_references(payload):
                cached_entries.append(payload)
            else:
                to_upload.append(p)
        else:
            to_upload.append(p)

    processed: List[Dict[str, Any]] = list(cached_entries)

    if not to_upload:
        result = {"cache_key": set_key, "processed": processed, "job_id": None, "status": "CACHED"}
        set_cache_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        return result

    ssl_context = ssl.create_default_context(cafile=certifi.where())
    ssl_context.minimum_version = ssl.TLSVersion.TLSv1_2
    transport = httpx.HTTPTransport(retries=5, verify=ssl_context)
    timeout = httpx.Timeout(connect=60.0, read=240.0, write=240.0, pool=60.0)

    limits = httpx.Limits(max_connections=1, max_keepalive_connections=0, keepalive_expiry=0.0)
    headers = {"Connection": "close", "Accept-Encoding": "identity"}

    client = httpx.Client(
        http2=False,
        timeout=timeout,
        limits=limits,
        transport=transport,
        trust_env=True,
        verify=ssl_context,
        headers=headers,
    )
    mistral = Mistral(api_key=api_key, client=client)

    uploaded: List[Dict[str, Any]] = []
    for idx, p_str in enumerate(to_upload):
        p = Path(p_str)

        client.close()
        client = httpx.Client(
            http2=False,
            timeout=timeout,
            limits=limits,
            transport=httpx.HTTPTransport(retries=5, verify=ssl_context),
            trust_env=True,
            verify=ssl_context,
            headers=headers,
        )
        mistral = Mistral(api_key=api_key, client=client)

        with p.open("rb") as fh:
            res = mistral.files.upload(file={"file_name": p.name, "content": fh}, purpose="ocr")

        uploaded.append({"custom_id": str(idx), "pdf_path": str(p), "file_id": res.id})

    batch_lines: List[str] = []
    for item in uploaded:
        signed = mistral.files.get_signed_url(file_id=item["file_id"]).url
        body: Dict[str, Any] = {
            "document": {"type": "document_url", "document_url": signed},
            "document_annotation_format": {"type": "json_schema", "json_schema": MISTRAL_REFERENCES_SCHEMA},
        }
        batch_lines.append(json.dumps({"custom_id": item["custom_id"], "body": body}, ensure_ascii=False))

    fd, path_str = tempfile.mkstemp(suffix=".jsonl")
    os.close(fd)
    p_batch = Path(path_str)

    with p_batch.open("w", encoding="utf-8", newline="\n") as f:
        for line in batch_lines:
            f.write(line)
            f.write("\n")

    with p_batch.open("rb") as fh:
        batch_file_rep = mistral.files.upload(file={"file_name": p_batch.name, "content": fh}, purpose="batch")
    p_batch.unlink()

    job = mistral.batch.jobs.create(
        input_files=[batch_file_rep.id],
        model=model,
        endpoint="/v1/ocr",
        metadata=metadata_job,
    )

    start_ts = time.time()
    status = None
    while True:
        status = mistral.batch.jobs.get(job_id=job.id)
        status_dict = status if isinstance(status, dict) else status.__dict__
        st = status_dict.get("status")
        if st not in {"QUEUED", "RUNNING"}:
            break
        if time.time() - start_ts > 3600:
            raise RuntimeError("Batch OCR timeout")
        time.sleep(5)

    status_dict = status if isinstance(status, dict) else status.__dict__
    output_file_id = status_dict.get("output_file")

    output_data: Dict[str, Any] = {}
    if output_file_id:
        stream = mistral.files.download(file_id=output_file_id)
        raw = stream.read().decode("utf-8", errors="replace")
        for line in raw.splitlines():
            if line.strip():
                rec = json.loads(line)
                output_data[str(rec.get("custom_id"))] = rec

    for item in uploaded:
        cid = item["custom_id"]
        pdf_path = item["pdf_path"]
        rec = output_data.get(cid, {})

        extracted = _extract_markdown_and_refs(rec)

        fcache = _per_file_cache_path(pdf_path)
        if fcache.is_file():
            existing = json.loads(fcache.read_text(encoding="utf-8"))
            merged = dict(existing)
        else:
            merged = {}

        if "pdf_path" not in merged:
            merged["pdf_path"] = pdf_path
        if "model" not in merged:
            merged["model"] = model
        if "pages" not in merged:
            merged["pages"] = pages
        if "metadata" not in merged and pdf_path in pdf_to_meta:
            merged["metadata"] = pdf_to_meta[pdf_path]

        md_new = extracted.get("markdown") or ""
        if ("markdown" not in merged or not str(merged.get("markdown") or "").strip()) and md_new.strip():
            merged["markdown"] = md_new

        sr_new = extracted.get("structured_references") or {"references": []}
        refs_new_nonempty = _nonempty_refs(sr_new.get("references") if isinstance(sr_new, dict) else [])

        sr_old = merged.get("structured_references")
        refs_old_nonempty = _nonempty_refs(sr_old.get("references") if isinstance(sr_old, dict) else [])

        if not isinstance(sr_old, dict):
            merged["structured_references"] = {"references": refs_old_nonempty or refs_new_nonempty}
        else:
            if "references" not in sr_old or not isinstance(sr_old.get("references"), list):
                sr_old["references"] = refs_old_nonempty or refs_new_nonempty
            elif (not refs_old_nonempty) and refs_new_nonempty:
                sr_old["references"] = refs_new_nonempty

        fcache.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
        processed.append(merged)

    result = {
        "cache_key": set_key,
        "processed": processed,
        "job_id": job.id,
        "status": status_dict.get("status"),
    }
    set_cache_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


import hashlib
import re
from typing import Any, Dict, List, Optional
def references_to_graph(
    structured_references: Dict[str, Any],
    source_doc_id: str,
) -> Dict[str, Any]:
    """
    ###1. normalize references payload into a list (tolerate wrappers / nesting)
    ###2. index full footnotes so short refs can be resolved ((n X) or footnote markers)
    ###3. build stable work nodes (dedupe)
    ###4. return widget-ready Cytoscape payload (nodes/edges are {"data": ...})
    """
    def _extract_refs(obj: Any, depth: int = 0) -> List[Dict[str, Any]]:
        if depth > 6:
            return []
        if isinstance(obj, list):
            return [x for x in obj if isinstance(x, dict)]
        if not isinstance(obj, dict):
            return []

        for k in ("references", "refs", "citations"):
            if k in obj:
                r = _extract_refs(obj.get(k), depth + 1)
                if r:
                    return r

        if len(obj) == 1:
            v = next(iter(obj.values()))
            r = _extract_refs(v, depth + 1)
            if r:
                return r

        for v in obj.values():
            r = _extract_refs(v, depth + 1)
            if r:
                return r

        return []

    refs = _extract_refs(structured_references)

    def _slug(s: str) -> str:
        s = (s or "").strip().lower()
        s = re.sub(r"\s+", " ", s)
        s = re.sub(r"[^a-z0-9]+", "-", s)
        return s.strip("-")

    def _hash(s: str) -> str:
        return hashlib.sha1((s or "").encode("utf-8")).hexdigest()[:12]

    def _to_int_or_none(x: Any) -> Optional[int]:
        if x is None:
            return None
        s = str(x).strip()
        if s.isdigit():
            return int(s)
        return None

    def _year_int(y: Any) -> int:
        s = "" if y is None else str(y).strip()
        digits = "".join([c for c in s if c.isdigit()])
        return int(digits) if digits else 0

    def _is_empty_str(x: Any) -> bool:
        return (not isinstance(x, str)) or (not x.strip())

    def _looks_like_short_ref(s: str) -> bool:
        return bool(re.search(r"\(n\s*\d+\)", s or ""))

    def _extract_n(s: str) -> Optional[int]:
        m = re.search(r"\(n\s*(\d+)\)", s or "")
        return int(m.group(1)) if m else None

    def _get_context(r: Dict[str, Any]) -> str:
        if isinstance(r.get("context_preceding"), str) and r.get("context_preceding").strip():
            return r.get("context_preceding").strip()
        if isinstance(r.get("context"), str) and r.get("context").strip():
            return r.get("context").strip()
        return ""

    def _get_anchor(r: Dict[str, Any]) -> str:
        a = r.get("citation_anchor")
        if isinstance(a, str) and a.strip():
            return a.strip()
        raw = r.get("raw")
        if isinstance(raw, str) and raw.strip():
            return raw.strip()
        return ""

    def _get_raw_for_node(r: Dict[str, Any]) -> str:
        raw = r.get("raw")
        if isinstance(raw, str) and raw.strip():
            return raw.strip()
        return _get_anchor(r)

    def _is_anchor_only(raw_s: str, author: str, year: str) -> bool:
        if _is_empty_str(raw_s):
            return True
        a = (author or "").strip()
        y = (year or "").strip()
        if not a or not y:
            return False
        pat = r"^\(\s*" + re.escape(a) + r"\s+" + re.escape(y) + r"\s*\)$"
        return bool(re.match(pat, raw_s.strip(), flags=re.IGNORECASE))

    def _work_id(author: str, year: str, raw_s: str) -> str:
        a = (author or "").strip()
        y = (year or "").strip()
        if a and y and _is_anchor_only(raw_s, a, y):
            return "work:" + ":".join([_slug(a), _slug(y)])
        if a and y:
            return "work:" + ":".join([_slug(a), _slug(y), _hash(raw_s)])
        return "work:" + _hash(raw_s)

    footnote_full: Dict[int, Dict[str, Any]] = {}
    for r in refs:
        fn = _to_int_or_none(r.get("footnote_number"))
        raw_s = _get_raw_for_node(r)
        if fn and fn > 0 and (not _is_empty_str(raw_s)) and (not _looks_like_short_ref(raw_s)):
            footnote_full[fn] = r

    nodes_by_id: Dict[str, Dict[str, Any]] = {
        source_doc_id: {
            "data": {
                "id": source_doc_id,
                "label": "source",
                "title": "source",
                "authors": "",
                "authors_str": "",
                "venue": "",
                "url": "",
                "abstract": "",
                "year": 0,
                "citations": 0,
                "doi": "",
                "external_id": source_doc_id,
                "isSeed": True,
            }
        }
    }

    edges_out: List[Dict[str, Any]] = []
    seen_edge_keys = set()

    def _ensure_work_node(work_ref: Dict[str, Any]) -> str:
        author = work_ref.get("author") or ""
        year = work_ref.get("year") or ""
        raw_s = _get_raw_for_node(work_ref)
        wid = _work_id(str(author), str(year), raw_s)

        if wid not in nodes_by_id:
            a = author.strip() if isinstance(author, str) else ""
            y = str(year).strip() if year is not None else ""
            if a and y and _is_anchor_only(raw_s, a, y):
                title = f"{a} ({y})"
            else:
                title = raw_s.strip() if isinstance(raw_s, str) else ""
                if not title:
                    title = f"{a} ({y})".strip() or wid

            nodes_by_id[wid] = {
                "data": {
                    "id": wid,
                    "label": title,
                    "title": title,
                    "authors": a,
                    "authors_str": a,
                    "venue": "",
                    "url": "",
                    "abstract": "",
                    "year": _year_int(year),
                    "citations": 0,
                    "doi": "",
                    "external_id": wid,
                    "isSeed": False,
                }
            }
        return wid

    edge_i = 0
    for r in refs:
        raw_s = _get_raw_for_node(r)
        if _is_empty_str(raw_s):
            continue

        target = r
        anchor = _get_anchor(r)

        if _looks_like_short_ref(raw_s) or _looks_like_short_ref(anchor):
            n = _extract_n(raw_s) or _extract_n(anchor)
            if n is not None and n in footnote_full:
                target = footnote_full[n]

        target_raw = _get_raw_for_node(target)
        if _is_empty_str(target_raw):
            continue

        wid = _ensure_work_node(target)

        fn = _to_int_or_none(r.get("footnote_number"))
        page_i = r.get("page_index")
        page_idx = page_i if isinstance(page_i, int) else None

        edge_key = (source_doc_id, wid, anchor, fn, page_idx, raw_s)
        if edge_key in seen_edge_keys:
            continue
        seen_edge_keys.add(edge_key)

        edge_i += 1
        edges_out.append(
            {
                "data": {
                    "id": f"edge:cites:{edge_i}",
                    "source": source_doc_id,
                    "target": wid,
                    "weight": 1.0,
                    "context": _get_context(r),
                    "citation_anchor": anchor,
                    "raw": raw_s,
                    "citation_type": r.get("citation_type") or "unknown",
                    "footnote_number": fn,
                    "page_index": page_idx,
                }
            }
        )

    cite_counts: Dict[str, int] = {}
    for e in edges_out:
        d = e.get("data") or {}
        wid = (d.get("target") or "").strip()
        if wid:
            cite_counts[wid] = cite_counts.get(wid, 0) + 1

    for wid, node in nodes_by_id.items():
        if wid == source_doc_id:
            continue
        d = node.get("data") or {}
        d["citations"] = int(cite_counts.get(wid, 0))

    return {
        "seedId": source_doc_id,
        "priorIds": [],
        "derivativeIds": [],
        "scope": "local",
        "build_ms": 0,
        "nodes": list(nodes_by_id.values()),
        "edges": edges_out,
    }

def global_references_graph(
    local_graphs: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    ###1. collect all paper (seed) nodes from local graphs
    ###2. build global work ids so the same work is shared across papers
    ###3. create edges paper->work (one per paper/work pair)
    ###4. set citations = number of distinct papers citing the work
    """
    def _slug(s: str) -> str:
        s = (s or "").strip().lower()
        s = re.sub(r"\s+", " ", s)
        s = re.sub(r"[^a-z0-9]+", "-", s)
        return s.strip("-")

    def _hash(s: str) -> str:
        return hashlib.sha1((s or "").encode("utf-8")).hexdigest()[:12]

    def _year_int(y: Any) -> int:
        s = "" if y is None else str(y).strip()
        digits = "".join([c for c in s if c.isdigit()])
        return int(digits) if digits else 0

    def _global_work_id(node_data: Dict[str, Any]) -> str:
        a = (node_data.get("authors") or node_data.get("authors_str") or "").strip()
        y = _year_int(node_data.get("year"))
        t = (node_data.get("title") or node_data.get("label") or "").strip()

        if a and y:
            return "gwork:" + ":".join([_slug(a), str(y)])
        if t:
            return "gwork:" + _slug(t) + ":" + _hash(t)
        raw = str(node_data.get("external_id") or node_data.get("id") or "")
        return "gwork:" + _hash(raw)

    nodes_by_id: Dict[str, Dict[str, Any]] = {}
    edges_out: List[Dict[str, Any]] = []
    seen_edge_keys = set()

    seed_ids: List[str] = []
    for g in local_graphs:
        sid = (g.get("seedId") or "").strip()
        if sid:
            seed_ids.append(sid)

    seed_ids = sorted(set(seed_ids))

    for sid in seed_ids:
        nodes_by_id[sid] = {
            "data": {
                "id": sid,
                "label": "source",
                "title": "source",
                "authors": "",
                "authors_str": "",
                "venue": "",
                "url": "",
                "abstract": "",
                "year": 0,
                "citations": 0,
                "doi": "",
                "external_id": sid,
                "isSeed": True,
            }
        }

    global_work_nodes: Dict[str, Dict[str, Any]] = {}
    work_to_seeds: Dict[str, set] = {}

    edge_i = 0
    for g in local_graphs:
        sid = (g.get("seedId") or "").strip()
        if not sid:
            continue

        local_nodes = g.get("nodes") or []
        local_edges = g.get("edges") or []

        local_node_by_id: Dict[str, Dict[str, Any]] = {}
        for n in local_nodes:
            d = n.get("data") or {}
            nid = (d.get("id") or "").strip()
            if nid:
                local_node_by_id[nid] = d

        for e in local_edges:
            ed = e.get("data") or {}
            tgt = (ed.get("target") or "").strip()
            if not tgt or tgt == sid:
                continue

            tgt_d = local_node_by_id.get(tgt) or {}
            gwid = _global_work_id(tgt_d)

            if gwid not in global_work_nodes:
                title = (tgt_d.get("title") or tgt_d.get("label") or "").strip() or gwid
                authors = (tgt_d.get("authors") or tgt_d.get("authors_str") or "").strip()
                year_val = _year_int(tgt_d.get("year"))
                global_work_nodes[gwid] = {
                    "data": {
                        "id": gwid,
                        "label": title,
                        "title": title,
                        "authors": authors,
                        "authors_str": authors,
                        "venue": (tgt_d.get("venue") or "").strip(),
                        "url": (tgt_d.get("url") or "").strip(),
                        "abstract": (tgt_d.get("abstract") or "").strip(),
                        "year": year_val,
                        "citations": 0,
                        "doi": (tgt_d.get("doi") or "").strip(),
                        "external_id": gwid,
                        "isSeed": False,
                    }
                }

            if gwid not in work_to_seeds:
                work_to_seeds[gwid] = set()
            work_to_seeds[gwid].add(sid)

            edge_key = (sid, gwid)
            if edge_key in seen_edge_keys:
                continue
            seen_edge_keys.add(edge_key)

            edge_i += 1
            edges_out.append(
                {
                    "data": {
                        "id": f"edge:global:cites:{edge_i}",
                        "source": sid,
                        "target": gwid,
                        "weight": 1.0,
                        "context": "",
                        "citation_anchor": "",
                        "raw": "",
                        "citation_type": "aggregated",
                        "footnote_number": None,
                        "page_index": None,
                    }
                }
            )

    for gwid, node in global_work_nodes.items():
        cited_by = work_to_seeds.get(gwid) or set()
        node["data"]["citations"] = int(len(cited_by))

    for gwid, node in global_work_nodes.items():
        nodes_by_id[gwid] = node

    return {
        "seedId": "global",
        "priorIds": [],
        "derivativeIds": [],
        "scope": "global",
        "build_ms": 0,
        "nodes": list(nodes_by_id.values()),
        "edges": edges_out,
    }
def references_local_global_graph(
    structured_payloads: Union[Dict[str, Any], List[Dict[str, Any]]],
) -> Dict[str, Any]:
    """
    ###1. normalize input payloads into a list
    ###2. normalize each payload into {"references": [...] } (tolerate wrappers / nesting)
    ###3. build local graphs via references_to_graph with stable doc ids
    ###4. build global graph via global_references_graph
    """
    payload_list = (
        [structured_payloads]
        if isinstance(structured_payloads, dict)
        else list(structured_payloads)
    )

    def _extract_structured_refs(obj: Any, depth: int = 0) -> Dict[str, Any]:
        if depth > 6:
            return {"references": []}

        if isinstance(obj, dict):
            if "references" in obj or "refs" in obj or "citations" in obj:
                return obj
            if len(obj) == 1:
                v = next(iter(obj.values()))
                if isinstance(v, (dict, list)):
                    return _extract_structured_refs(v, depth + 1)
            for v in obj.values():
                if isinstance(v, (dict, list)):
                    out = _extract_structured_refs(v, depth + 1)
                    if out.get("references") or out.get("refs") or out.get("citations"):
                        return out
            return {"references": []}

        if isinstance(obj, list):
            return {"references": [x for x in obj if isinstance(x, dict)]}

        return {"references": []}

    local_graphs: List[Dict[str, Any]] = []
    for i, payload in enumerate(payload_list):
        structured = _extract_structured_refs(payload)
        doc_id = f"doc:{i+1}"
        local_graphs.append(references_to_graph(structured, doc_id))

    global_graph = global_references_graph(local_graphs)

    return {
        "local": local_graphs,
        "global": global_graph,
    }

sample_structured_references_list = [
    {
        "references": [
            {
                "citation_type": "in_text",
                "citation_anchor": "(Smith 2022)",
                "context_preceding": "This paper frames evidentiary thresholds for attribution decisions.",
                "author": "Smith",
                "year": "2022",
                "raw": "(Smith 2022)",
                "footnote_number": None,
                "page_index": 1,
            },
            {
                "citation_type": "in_text",
                "citation_anchor": "(Ronen 2020)",
                "context_preceding": "It adopts a research programme on feasibility and advisability of evidentiary standards.",
                "author": "Ronen",
                "year": "2020",
                "raw": "(Ronen 2020)",
                "footnote_number": None,
                "page_index": 2,
            },
            {
                "citation_type": "in_text",
                "citation_anchor": "(Kinsch 2009)",
                "context_preceding": "A comparative examination finds no uniform standard of proof.",
                "author": "Kinsch",
                "year": "2009",
                "raw": "(Kinsch 2009)",
                "footnote_number": None,
                "page_index": 3,
            },
            {
                "citation_type": "in_text",
                "citation_anchor": "(Devaney 2016)",
                "context_preceding": "International law’s approach to procedure and evidence is flexible.",
                "author": "Devaney",
                "year": "2016",
                "raw": "(Devaney 2016)",
                "footnote_number": None,
                "page_index": 3,
            },
            {
                "citation_type": "footnote",
                "citation_anchor": "33",
                "context_preceding": "33",
                "author": "Chittaranjan F Amerasinghe",
                "year": "2005",
                "raw": "Chittaranjan F Amerasinghe, Evidence in International Litigation (Martinus Nijhoff 2005) 96-97.",
                "footnote_number": 33,
                "page_index": 4,
            },
            {
                "citation_type": "footnote",
                "citation_anchor": "34",
                "context_preceding": "34",
                "author": "Pulp Mills",
                "year": "2010",
                "raw": "Pulp Mills (n 16), [163].",
                "footnote_number": 34,
                "page_index": 4,
            },
            {
                "citation_type": "footnote",
                "citation_anchor": "39",
                "context_preceding": "39",
                "author": "Dederer and Singer",
                "year": "2019",
                "raw": "Hans-Georg Dederer and Tassilo Singer, 'Adverse Cyber Operations: Causality, Attribution, Evidence, and Due Diligence' (2019) 95 International Law Studies 430, 459.",
                "footnote_number": 39,
                "page_index": 5,
            },
            {
                "citation_type": "footnote",
                "citation_anchor": "40",
                "context_preceding": "40",
                "author": "ICJ",
                "year": "1949",
                "raw": "ICJ, Corfu Channel, Judgment of April 9th, 1949 (Merits) [1949] ICJ Rep 4, 17.",
                "footnote_number": 40,
                "page_index": 5,
            },
            {
                "citation_type": "footnote",
                "citation_anchor": "51",
                "context_preceding": "51",
                "author": "Smith",
                "year": "2022",
                "raw": "Smith (n 1) 44-47.",
                "footnote_number": 51,
                "page_index": 6,
            },
            {
                "citation_type": "footnote",
                "citation_anchor": "56",
                "context_preceding": "56",
                "author": "Corfu",
                "year": "1949",
                "raw": "Corfu (n 40), 17.",
                "footnote_number": 56,
                "page_index": 6,
            },
        ]
    },
    {
        "references": [
            {
                "citation_type": "in_text",
                "citation_anchor": "(Smith 2022)",
                "context_preceding": "The analysis uses Smith’s policy-sensitive evidentiary framework.",
                "author": "Smith",
                "year": "2022",
                "raw": "(Smith 2022)",
                "footnote_number": None,
                "page_index": 1,
            },
            {
                "citation_type": "in_text",
                "citation_anchor": "(Foster 2010)",
                "context_preceding": "Burden and standard of proof interact with admissibility and presumptions.",
                "author": "Foster",
                "year": "2010",
                "raw": "(Foster 2010)",
                "footnote_number": None,
                "page_index": 2,
            },
            {
                "citation_type": "in_text",
                "citation_anchor": "(Devaney 2016)",
                "context_preceding": "The doctrinal approach treats evidentiary rules as context-dependent.",
                "author": "Devaney",
                "year": "2016",
                "raw": "(Devaney 2016)",
                "footnote_number": None,
                "page_index": 2,
            },
            {
                "citation_type": "in_text",
                "citation_anchor": "(Ronen 2020)",
                "context_preceding": "It aligns with Ronen’s account of evidentiary practice across regimes.",
                "author": "Ronen",
                "year": "2020",
                "raw": "(Ronen 2020)",
                "footnote_number": None,
                "page_index": 3,
            },
            {
                "citation_type": "footnote",
                "citation_anchor": "12",
                "context_preceding": "12",
                "author": "ICJ",
                "year": "1949",
                "raw": "ICJ, Corfu Channel, Judgment of April 9th, 1949 (Merits) [1949] ICJ Rep 4, 17.",
                "footnote_number": 12,
                "page_index": 4,
            },
            {
                "citation_type": "footnote",
                "citation_anchor": "13",
                "context_preceding": "13",
                "author": "Corfu",
                "year": "1949",
                "raw": "Corfu (n 12), 16.",
                "footnote_number": 13,
                "page_index": 4,
            },
            {
                "citation_type": "footnote",
                "citation_anchor": "20",
                "context_preceding": "20",
                "author": "Dederer and Singer",
                "year": "2019",
                "raw": "Dederer and Singer (n 20), 444-445.",
                "footnote_number": 20,
                "page_index": 5,
            },
            {
                "citation_type": "footnote",
                "citation_anchor": "21",
                "context_preceding": "21",
                "author": "Chittaranjan F Amerasinghe",
                "year": "2005",
                "raw": "Amerasinghe (n 21) 234.",
                "footnote_number": 21,
                "page_index": 5,
            },
            {
                "citation_type": "footnote",
                "citation_anchor": "22",
                "context_preceding": "22",
                "author": "Kinsch",
                "year": "2009",
                "raw": "Kinsch (2009) 436.",
                "footnote_number": 22,
                "page_index": 6,
            },
            {
                "citation_type": "footnote",
                "citation_anchor": "23",
                "context_preceding": "23",
                "author": "Smith",
                "year": "2022",
                "raw": "Smith, Evidentiary Thresholds in Cyber Attribution (2022) 77-81.",
                "footnote_number": 23,
                "page_index": 6,
            },
        ]
    },
    {
        "references": [
            {
                "citation_type": "in_text",
                "citation_anchor": "(Smith 2022)",
                "context_preceding": "This paper uses Smith to motivate a burden-shifting model under information asymmetry.",
                "author": "Smith",
                "year": "2022",
                "raw": "(Smith 2022)",
                "footnote_number": None,
                "page_index": 1,
            },
            {
                "citation_type": "in_text",
                "citation_anchor": "(Shelton 1988)",
                "context_preceding": "Burden allocation can vary within the same proceedings.",
                "author": "Shelton",
                "year": "1988",
                "raw": "(Shelton 1988)",
                "footnote_number": None,
                "page_index": 2,
            },
            {
                "citation_type": "in_text",
                "citation_anchor": "(Varnava and Others v Turkey 2009)",
                "context_preceding": "The ECtHR discussed burden shift where facts lie within exclusive control.",
                "author": "Varnava and Others v Turkey",
                "year": "2009",
                "raw": "(Varnava and Others v Turkey 2009)",
                "footnote_number": None,
                "page_index": 3,
            },
            {
                "citation_type": "in_text",
                "citation_anchor": "(Benzing 2019)",
                "context_preceding": "A duty to cooperate is used to limit the effect of informational monopolies.",
                "author": "Benzing",
                "year": "2019",
                "raw": "(Benzing 2019)",
                "footnote_number": None,
                "page_index": 3,
            },
            {
                "citation_type": "footnote",
                "citation_anchor": "7",
                "context_preceding": "7",
                "author": "ECtHR",
                "year": "1978",
                "raw": "ECtHR, Ireland v United Kingdom (Application No. 5310/71), Judgement, para 161.",
                "footnote_number": 7,
                "page_index": 4,
            },
            {
                "citation_type": "footnote",
                "citation_anchor": "8",
                "context_preceding": "8",
                "author": "Varnava",
                "year": "2009",
                "raw": "Varnava (n 29) para 182.",
                "footnote_number": 8,
                "page_index": 4,
            },
            {
                "citation_type": "footnote",
                "citation_anchor": "9",
                "context_preceding": "9",
                "author": "Kinsch",
                "year": "2009",
                "raw": "Kinsch (2009) 436.",
                "footnote_number": 9,
                "page_index": 5,
            },
            {
                "citation_type": "footnote",
                "citation_anchor": "10",
                "context_preceding": "10",
                "author": "Ronen",
                "year": "2020",
                "raw": "Ronen (2020) 12-15.",
                "footnote_number": 10,
                "page_index": 5,
            },
            {
                "citation_type": "footnote",
                "citation_anchor": "11",
                "context_preceding": "11",
                "author": "Smith",
                "year": "2022",
                "raw": "Smith (n 1) 44-47.",
                "footnote_number": 11,
                "page_index": 6,
            },
            {
                "citation_type": "footnote",
                "citation_anchor": "12",
                "context_preceding": "12",
                "author": "Chittaranjan F Amerasinghe",
                "year": "2005",
                "raw": "Amerasinghe, Evidence in International Litigation (2005) 96-97.",
                "footnote_number": 12,
                "page_index": 6,
            },
        ]
    },
    {
        "references": [
            {
                "citation_type": "in_text",
                "citation_anchor": "(Smith 2022)",
                "context_preceding": "This paper treats Smith as the baseline for evidentiary confidence across documents.",
                "author": "Smith",
                "year": "2022",
                "raw": "(Smith 2022)",
                "footnote_number": None,
                "page_index": 1,
            },
            {
                "citation_type": "in_text",
                "citation_anchor": "(Ronen 2020)",
                "context_preceding": "It also cites Ronen’s overview of attribution standards.",
                "author": "Ronen",
                "year": "2020",
                "raw": "(Ronen 2020)",
                "footnote_number": None,
                "page_index": 2,
            },
            {
                "citation_type": "in_text",
                "citation_anchor": "(Benzing 2019)",
                "context_preceding": "Cooperation duties are discussed as a mitigation technique.",
                "author": "Benzing",
                "year": "2019",
                "raw": "(Benzing 2019)",
                "footnote_number": None,
                "page_index": 2,
            },
            {
                "citation_type": "in_text",
                "citation_anchor": "(Dederer and Singer 2019)",
                "context_preceding": "It borrows a causality and due diligence lens for cyber operations.",
                "author": "Dederer and Singer",
                "year": "2019",
                "raw": "(Dederer and Singer 2019)",
                "footnote_number": None,
                "page_index": 3,
            },
            {
                "citation_type": "footnote",
                "citation_anchor": "42",
                "context_preceding": "42",
                "author": "Eritrea-Ethiopia Claims Commission",
                "year": "2003",
                "raw": "Eritrea-Ethiopia Claims Commission, Partial Award: Prisoners of War - Ethiopia’s Claim 4 XXVI RIAA 73 (1 July 2003) para 38.",
                "footnote_number": 42,
                "page_index": 4,
            },
            {
                "citation_type": "footnote",
                "citation_anchor": "43",
                "context_preceding": "43",
                "author": "ICJ",
                "year": "2005",
                "raw": "Case concerning Armed Activities on the Territory of the Congo (DRC v Uganda), Judgment, ICJ [2005] Reports, [62].",
                "footnote_number": 43,
                "page_index": 4,
            },
            {
                "citation_type": "footnote",
                "citation_anchor": "44",
                "context_preceding": "44",
                "author": "ICJ",
                "year": "1949",
                "raw": "ICJ, Corfu Channel, Judgment of April 9th, 1949 (Merits) [1949] ICJ Rep 4, 17.",
                "footnote_number": 44,
                "page_index": 5,
            },
            {
                "citation_type": "footnote",
                "citation_anchor": "45",
                "context_preceding": "45",
                "author": "Corfu",
                "year": "1949",
                "raw": "Corfu (n 44), 17.",
                "footnote_number": 45,
                "page_index": 5,
            },
            {
                "citation_type": "footnote",
                "citation_anchor": "46",
                "context_preceding": "46",
                "author": "Kinsch",
                "year": "2009",
                "raw": "Kinsch (2009) 436.",
                "footnote_number": 46,
                "page_index": 6,
            },
            {
                "citation_type": "footnote",
                "citation_anchor": "47",
                "context_preceding": "47",
                "author": "Smith",
                "year": "2022",
                "raw": "Smith, Evidentiary Thresholds in Cyber Attribution (2022) 77-81.",
                "footnote_number": 47,
                "page_index": 6,
            },
        ]
    },
]
def _canon_path_for_cache(p: str | Path) -> str:
    """
    ###1. normalise for stable hashing across runs
    ###2. return a string suitable for sha256 keying
    """
    s = str(Path(p).expanduser().resolve())
    s = os.path.normpath(s)
    s = os.path.normcase(s)
    return s


def load_mistral_ocr_markdown_from_cache(
    pdf_path: str | Path,
    *,
    cache_root: str | Path | None = None,
) -> str:
    """
    ###1. compute the same per-file cache key used by your Mistral OCR cache
    ###2. load the JSON cache payload
    ###3. return cached "markdown" (or empty string if missing)
    """
    pdf_path = Path(pdf_path).expanduser().resolve()

    home = Path.home()
    base = Path(cache_root).expanduser().resolve() if cache_root else (home / "annotarium" / "cache" / "mistral")
    files_dir = base / "files"

    canon = _canon_path_for_cache(pdf_path)
    h = hashlib.sha256(canon.encode("utf-8")).hexdigest()
    fcache = files_dir / f"{h}.json"

    if not fcache.is_file():
        return ""

    payload = json.loads(fcache.read_text(encoding="utf-8"))
    md = payload.get("markdown")
    return md if isinstance(md, str) else ""

def get_tiktoken_encoding() -> Any:
    """
    ###1. return a stable encoding for OpenAI-family token counting
    """
    import tiktoken
    return tiktoken.get_encoding("o200k_base")


def token_count_tiktoken(text: str, enc: Any | None = None) -> int:
    """
    ###1. count tokens using tiktoken encoding
    """
    e = enc or get_tiktoken_encoding()
    s = text or ""
    return len(e.encode(s))

def _split_text_by_tokens(text: str, *, enc: Any, max_tokens: int) -> list[str]:
    """
    ###1. split one string into <= max_tokens token slices using tiktoken
    """
    s = text or ""
    toks = enc.encode(s)
    if len(toks) <= max_tokens:
        return [s]

    out: list[str] = []
    i = 0
    n = len(toks)
    while i < n:
        j = i + max_tokens
        piece = enc.decode(toks[i:j]).strip()
        if piece:
            out.append(piece)
        i = j
    return out


def chunk_text_token_capped(
    text: str,
    *,
    max_tokens: int,
    overlap_tokens: int = 0,
    enc: Any | None = None,
) -> list[str]:
    """
    ###1. split into paragraphs
    ###2. split any oversized paragraph into <= max_tokens slices
    ###3. pack slices into chunks up to max_tokens (exact, tiktoken)
    ###4. overlap by reusing trailing slices up to overlap_tokens
    """
    if not isinstance(text, str) or not text.strip():
        return []

    e = enc or get_tiktoken_encoding()
    cap = int(max_tokens) if int(max_tokens) > 1 else 1
    ov = int(overlap_tokens) if int(overlap_tokens) > 0 else 0

    paras = [p.strip() for p in re.split(r"\n{2,}", text) if p.strip()]
    units: list[str] = []
    for p in paras:
        units.extend(_split_text_by_tokens(p, enc=e, max_tokens=cap))

    chunks: list[str] = []
    cur_units: list[str] = []
    cur_tok = 0

    for u in units:
        ut = token_count_tiktoken(u, enc=e)

        if not cur_units:
            cur_units = [u]
            cur_tok = ut
            continue

        joiner_tok = token_count_tiktoken("\n\n", enc=e)
        projected = cur_tok + joiner_tok + ut

        if projected <= cap:
            cur_units.append(u)
            cur_tok = projected
            continue

        chunk = "\n\n".join(cur_units).strip()
        if chunk:
            chunks.append(chunk)

        if ov > 0:
            tail: list[str] = []
            tail_tok = 0
            for q in reversed(cur_units):
                qt = token_count_tiktoken(q, enc=e)
                if tail and tail_tok + joiner_tok + qt > ov:
                    break
                tail.insert(0, q)
                if not tail_tok:
                    tail_tok = qt
                else:
                    tail_tok = tail_tok + joiner_tok + qt
            cur_units = tail[:] if tail else []
            cur_tok = tail_tok
        else:
            cur_units = []
            cur_tok = 0

        if ut > cap:
            for piece in _split_text_by_tokens(u, enc=e, max_tokens=cap):
                if piece.strip():
                    chunks.append(piece.strip())
            cur_units = []
            cur_tok = 0
        else:
            cur_units = [u]
            cur_tok = ut

    if cur_units:
        chunk = "\n\n".join(cur_units).strip()
        if chunk:
            chunks.append(chunk)

    return chunks



# outputs= ocr_single_pdf_structured(
#     pdf_path='C:\\Users\\luano\\Zotero\\storage\\2DFBFQRI\\Mikanagi and Macak - 2020 - Attribution of cyber operations an  international law perspective on the park jin hyok case.pdf',
#     api_key=api_key)

# out={'references': [{'citation_type': 'in_text', 'citation_anchor': '(Ronen 2020)', 'context_preceding': 'This project is part of a larger research initiative to examine the feasibility and advisability of an', 'author': 'Ronen', 'year': '2020', 'raw': '(Ronen 2020)', 'footnote_number': None, 'page_index': 2}, {'citation_type': 'in_text', 'citation_anchor': '(Kinsch 2009)', 'context_preceding': 'However, a comparative examination reveals that at least with regard to the standard of proof there is no uniformity that could be the basis', 'author': 'Kinsch', 'year': '2009', 'raw': '(Kinsch 2009)', 'footnote_number': None, 'page_index': 3}, {'citation_type': 'in_text', 'citation_anchor': '(Devaney 2016)', 'context_preceding': "The approach of international law to procedural and evidentiary issues has been characterised as extremely flexible. As noted in the ICJ, 'international law ... being primarily based upon the general", 'author': 'Devaney', 'year': '2016', 'raw': '(Devaney 2016)', 'footnote_number': None, 'page_index': 3}, {'citation_type': 'in_text', 'citation_anchor': '(Selby 1992)', 'context_preceding': 'There are increasing calls for the adoption of a formal standard, and since the beginning of the twenty first century, international jurisprudence has been visibly more concerned', 'author': 'Selby', 'year': '1992', 'raw': '(Selby 1992)', 'footnote_number': None, 'page_index': 3}, {'citation_type': 'in_text', 'citation_anchor': '(Alvarez 1993)', 'context_preceding': 'In devising a mechanism for dispute settlement, generalisations based on the practice of tribunals should be therefore be drawn with caution.', 'author': 'Alvarez', 'year': '1993', 'raw': '(Alvarez 1993)', 'footnote_number': None, 'page_index': 4}, {'citation_type': 'in_text', 'citation_anchor': '(Green 2009)', 'context_preceding': 'Specifically in the context of attribution of attacks, conventional or through cyber operations, the question has arisen whether the evidentiary requirements, in particular the standard of', 'author': 'Green', 'year': '2009', 'raw': '(Green 2009)', 'footnote_number': None, 'page_index': 4}, {'citation_type': 'in_text', 'citation_anchor': '(Lobel 1999)', 'context_preceding': 'It has been argued that practical time and access constraints in obtaining evidence justify a lower standard when at issue is a response in self defence. On the other hand, the consequences of armed response are much graver than the', 'author': 'Lobel', 'year': '1999', 'raw': '(Lobel 1999)', 'footnote_number': None, 'page_index': 4}, {'citation_type': 'in_text', 'citation_anchor': '(Franck and Prows 2005)', 'context_preceding': 'Factors such as the type of parties (states or private actors), the composition of the bench, the technical complexity of issues and the expertise of the mechanism, and the distance in time and space from the alleged breach, raise', 'author': 'Franck and Prows', 'year': '2005', 'raw': '(Franck and Prows 2005)', 'footnote_number': None, 'page_index': 4}, {'citation_type': 'in_text', 'citation_anchor': '(Foster 2010)', 'context_preceding': 'While this paper discusses burden of proof, standard of proof and evidence separately of each other, these issues are interrelated. For example, difficulties in meeting the burden of proof may be alleviated by factual presumptions and a liberal approach to evidence admissibility.', 'author': 'Foster', 'year': '2010', 'raw': '(Foster 2010)', 'footnote_number': None, 'page_index': 5}, {'citation_type': 'in_text', 'citation_anchor': '(Shelton 1988)', 'context_preceding': 'It is therefore an assertion to the contrary that requires proof. Placing the burden of proving a fact on the party alleging it means that within the same proceedings each party bears the burden with regards to different facts, depending on the subject-matter and on the nature of the', 'author': 'Shelton', 'year': '1988', 'raw': '(Shelton 1988)', 'footnote_number': None, 'page_index': 5}, {'citation_type': 'in_text', 'citation_anchor': '(Higgins 2007)', 'context_preceding': 'The WTO Appellate Body held that Article 10.3 of the Agreement on Agriculture partially reverses the burden of proof. Once a claimant proved the first part of the claim (that excess quantity has been exported), the respondent must prove the second part of the claim (that no export subsidy has been granted).', 'author': 'Higgins', 'year': '2007', 'raw': '(Higgins 2007)', 'footnote_number': None, 'page_index': 5}, {'citation_type': 'in_text', 'citation_anchor': '(Foster 2010)', 'context_preceding': 'A shift (or reversal) of the burden of proof from the party alleging a fact to its adversary has been proposed in a number of contexts. One is when the ordinary location of the burden gives a party some unfair advantage over the other.', 'author': 'Foster', 'year': '2010', 'raw': '(Foster 2010)', 'footnote_number': None, 'page_index': 6}, {'citation_type': 'in_text', 'citation_anchor': '(Devaney 2016)', 'context_preceding': 'The WTO has also not been prepared to accept that relative ease of access to pertinent information determines the allocation of the burden.', 'author': 'Devaney', 'year': '2016', 'raw': '(Devaney 2016)', 'footnote_number': None, 'page_index': 6}, {'citation_type': 'in_text', 'citation_anchor': '(Diallo 2010)', 'context_preceding': 'One basis for reversal of the burden of proof that has received some judicial support is where the allegation is of a negative fact. The argument is that the respondent to such an allegation is in a superior position to prove its compliance with law through its positive action, and a negative fact may be impossible to prove.', 'author': 'Diallo', 'year': '2010', 'raw': '(Diallo 2010)', 'footnote_number': None, 'page_index': 6}, {'citation_type': 'in_text', 'citation_anchor': '(Varnava and Others v Turkey 2009)', 'context_preceding': "It has been suggested that the ECtHR has adopted the principle on the shift of burden specifically with regard to claims of enforced disappearance. The Court has stated that 'where persons are found injured or dead, or who have disappeared, in an area within the exclusive control of the authorities of the State and there is prima facie evidence that the State may be involved, the burden of proof may also shift to the Government since the events in issue may lie wholly, or in large part, within the exclusive knowledge of the authorities'.", 'author': 'Varnava and Others v Turkey', 'year': '2009', 'raw': '(Varnava and Others v Turkey 2009)', 'footnote_number': None, 'page_index': 7}, {'citation_type': 'in_text', 'citation_anchor': '(Shelton 1988)', 'context_preceding': 'Human rights tribunals are a forum where both rationales for shifting the burden (or using presumptions that alleviate it) are relevant. First, the dispute before the tribunal is between a state and an individual, a situation in which disparities in power and resources is immense.', 'author': 'Shelton', 'year': '1988', 'raw': '(Shelton 1988)', 'footnote_number': None, 'page_index': 7}, {'citation_type': 'in_text', 'citation_anchor': '(Benzing 2019)', 'context_preceding': "The maintenance of the burden of proof on the party alleging a fact, irrespective of this party's access to information is somewhat mitigated by the general duty that states are said to bear, to collaborate in good faith for the administration of evidence.", 'author': 'Benzing', 'year': '2019', 'raw': '(Benzing 2019)', 'footnote_number': None, 'page_index': 7}, {'citation_type': 'in_text', 'citation_anchor': '(Ronen 2020)', 'context_preceding': '© Yaël Ronen (April 2020)', 'author': 'Ronen', 'year': '2020', 'raw': '© Yaël Ronen (April 2020)', 'footnote_number': None, 'page_index': 0}, {'citation_type': 'footnote', 'citation_anchor': '33', 'context_preceding': '33', 'author': 'Chittaranjan F Amerasinghe', 'year': '2005', 'raw': 'Chittaranjan F Amerasinghe, Evidence in International Litigation (Martinus Nijhoff 2005) 96-97.', 'footnote_number': 33, 'page_index': 1}, {'citation_type': 'footnote', 'citation_anchor': '34', 'context_preceding': '34', 'author': 'Pulp Mills', 'year': '2010', 'raw': 'Pulp Mills (n 16), [163].', 'footnote_number': 34, 'page_index': 1}, {'citation_type': 'footnote', 'citation_anchor': '35', 'context_preceding': '35', 'author': 'WTO', 'year': '1997', 'raw': 'WTO, Argentina - Measures Affecting Imports of Footwear, Textiles, Apparel and Other Items Report of the Panel. WT/DS56/R (25 November 1997) para 6.40.', 'footnote_number': 35, 'page_index': 1}, {'citation_type': 'footnote', 'citation_anchor': '36', 'context_preceding': '36', 'author': 'Devaney', 'year': '2000', 'raw': 'For IUSCT practice see Devaney (n 2) 55-156, 200.', 'footnote_number': 36, 'page_index': 1}, {'citation_type': 'footnote', 'citation_anchor': '37', 'context_preceding': '37', 'author': 'Antonopoulos', 'year': '2015', 'raw': "Constantine Antonopoulos, 'State Responsibility in Cyberspace', in Nicholas Tsagourias and Russell Buchan (eds) Research Handbook on International Law and Cyberspace (Edward Elgar 2015) 55, 64.", 'footnote_number': 37, 'page_index': 1}, {'citation_type': 'in_text', 'citation_anchor': '(Ronen 2020)', 'context_preceding': '© Yaël Ronen (April 2020)', 'author': 'Ronen', 'year': '2020', 'raw': '© Yaël Ronen (April 2020)', 'footnote_number': None, 'page_index': 2}, {'citation_type': 'footnote', 'citation_anchor': '38', 'context_preceding': '38', 'author': 'Margulies', 'year': '2013', 'raw': "Peter Margulies, 'Sovereignty and Cyberattacks: Technology’s Challenge to the Law of State Responsibility' (2013) 14 Melbourne Journal of International Law 496.", 'footnote_number': 38, 'page_index': 2}, {'citation_type': 'footnote', 'citation_anchor': '39', 'context_preceding': '39', 'author': 'Dederer and Singer', 'year': '2019', 'raw': "Hans-Georg Dederer and Tassilo Singer, 'Adverse Cyber Operations: Causality, Attribution, Evidence, and Due Diligence' (2019) 95 International Law Studies 430, 459.", 'footnote_number': 39, 'page_index': 2}, {'citation_type': 'footnote', 'citation_anchor': '40', 'context_preceding': '40', 'author': 'ICJ', 'year': '1949', 'raw': 'ICJ, Corfu Channel, Judgment of April 9th, 1949 (Merits) [1949] ICJ Rep 4, 17.', 'footnote_number': 40, 'page_index': 2}, {'citation_type': 'in_text', 'citation_anchor': '(Ronen 2020)', 'context_preceding': '© Yaël Ronen (April 2020)', 'author': 'Ronen', 'year': '2020', 'raw': '© Yaël Ronen (April 2020)', 'footnote_number': None, 'page_index': 3}, {'citation_type': 'footnote', 'citation_anchor': '41', 'context_preceding': '41', 'author': 'Bosnia Genocide', 'year': '2007', 'raw': "Bosnia Genocide (n 16), [181] ('Under its Statute the Court has the capacity to undertake that task, while applying the standard of proof appropriate to charges of exceptional gravity (paragraphs 209-210 below)').", 'footnote_number': 41, 'page_index': 3}, {'citation_type': 'footnote', 'citation_anchor': '42', 'context_preceding': '42', 'author': 'Eritrea-Ethiopia Claims Commission', 'year': '2003', 'raw': "Eritrea-Ethiopia Claims Commission, Partial Award: Prisoners of War - Ethiopia’s Claim 4 XXVI RIAA 73 (1 July 2003) para 38, and Partial Award: Prisoners of War - Eritrea’s Claim 17’ (2003) XXVI RIAA 23 para 47; Application of the Convention on the Prevention and Punishment of the Crime of Genocide (Croatia v. Serbia), Judgment [2015] ICJ Rep 3, Separate Opinion of Judge Gaja, para 4; Paula Gaeta, 'On What Conditions Can a State Be Held Responsible for Genocide?' (2007) 18 European Journal of International Law 631; Andrea Gattini, 'Evidentiary Issues in the ICJ’s Genocide Judgment' (2007) 5 Journal of International Criminal Justice 889; Dermot Groome, 'Adjudicating Genocide: Is the International Court of Justice Capable of Judging State Criminal Responsibility?' (2008) 31 Fordham International Law Journal 911.", 'footnote_number': 42, 'page_index': 3}, {'citation_type': 'footnote', 'citation_anchor': '43', 'context_preceding': '43', 'author': "O'Connell", 'year': '2002', 'raw': "Writing in 2002, O’Connell suggested that the rule of attribution should be the same as the rule for the facts of the attack. Mary Ellen O’Connell, 'Lawful Self-Defense to Terrorism Symposium: Post-September 11 Legal Topics' (2001-2002) 63 University of Pittsburgh Law Review 889, 900.", 'footnote_number': 43, 'page_index': 3}, {'citation_type': 'footnote', 'citation_anchor': '44', 'context_preceding': '44', 'author': 'Milanovic', 'year': '2011', 'raw': 'Milanovic (n 5), 597.', 'footnote_number': 44, 'page_index': 3}, {'citation_type': 'footnote', 'citation_anchor': '45', 'context_preceding': '45', 'author': 'ILC', 'year': '1974', 'raw': 'ILC, Yearbook of the International Law Commission, 1974 vol II, Part One, 285 para 8.', 'footnote_number': 45, 'page_index': 3}, {'citation_type': 'footnote', 'citation_anchor': '46', 'context_preceding': '46', 'author': 'ILC', 'year': '2001', 'raw': "ILC, 'Draft Articles on Responsibility of States for Internationally Wrongful Acts, with Commentaries (2001) UN Doc A/56/10 54, Commentary to ch III para 4.", 'footnote_number': 46, 'page_index': 3}, {'citation_type': 'in_text', 'citation_anchor': '(Ronen 2020)', 'context_preceding': '© Yaël Ronen (April 2020)', 'author': 'Ronen', 'year': '2020', 'raw': '© Yaël Ronen (April 2020)', 'footnote_number': None, 'page_index': 4}, {'citation_type': 'footnote', 'citation_anchor': '47', 'context_preceding': '47', 'author': 'Eritrea-Ethiopia Claims Commission', 'year': '2003', 'raw': 'Eritrea-Ethiopia Claims Commission, Partial Award: Prisoners of War - Ethiopia’s Claim 4 XXVI RIAA 73, para 38.', 'footnote_number': 47, 'page_index': 4}, {'citation_type': 'footnote', 'citation_anchor': '48', 'context_preceding': '48', 'author': 'Eritrea-Ethiopia Claims Commission', 'year': '2003', 'raw': 'Eritrea-Ethiopia Claims Commission, Partial Award: Prisoners of War - Ethiopia’s Claim 4 XXVI RIAA 73, para 37.', 'footnote_number': 48, 'page_index': 4}, {'citation_type': 'footnote', 'citation_anchor': '49', 'context_preceding': '49', 'author': 'Croatia Genocide', 'year': '2015', 'raw': "Croatia Genocide (n 42), Separate Opinion of Judge Gaja para 4 ('However, it would be difficult to explain why the seriousness of the alleged wrongful act and its connection with international crimes should make the establishment of international responsibility more difficult').", 'footnote_number': 49, 'page_index': 4}, {'citation_type': 'footnote', 'citation_anchor': '50', 'context_preceding': '50', 'author': 'Milanovic', 'year': '2011', 'raw': 'Milanovic (n 5) 597.', 'footnote_number': 50, 'page_index': 4}, {'citation_type': 'footnote', 'citation_anchor': '51', 'context_preceding': '51', 'author': 'Dederer and Singer', 'year': '2019', 'raw': 'For explicitly endorsing the linkage see Dederer and Singer (n 39), 444-445.', 'footnote_number': 51, 'page_index': 4}, {'citation_type': 'footnote', 'citation_anchor': '52', 'context_preceding': '52', 'author': 'Corfu', 'year': '1949', 'raw': 'Corfu (n 40), 14.', 'footnote_number': 52, 'page_index': 4}, {'citation_type': 'footnote', 'citation_anchor': '53', 'context_preceding': '53', 'author': 'Nicaragua', 'year': '1984', 'raw': 'Nicaragua (n 16), [158].', 'footnote_number': 53, 'page_index': 4}, {'citation_type': 'footnote', 'citation_anchor': '54', 'context_preceding': '54', 'author': 'ICJ', 'year': '2005', 'raw': 'Case concerning Armed Activities on the Territory of the Congo (Democratic Republic of the Congo v. Uganda), Judgment, ICJ [2005] Reports 2005, [62], [71], [106]; Case concerning Military and Paramilitary Activities in and Against Nicaragua (Nicaragua v. United States of America), Request for the Indication of Provisional Measures, Order of 10 May 1984, ICJ Reports 1984, p. 179, para. 25.', 'footnote_number': 54, 'page_index': 4}, {'citation_type': 'footnote', 'citation_anchor': '55', 'context_preceding': '55', 'author': 'Oil Platforms', 'year': '2003', 'raw': 'Oil Platforms (n 5), Separate Opinion of Judge Kooijmans, para 63.', 'footnote_number': 55, 'page_index': 4}, {'citation_type': 'footnote', 'citation_anchor': '56', 'context_preceding': '56', 'author': 'Corfu', 'year': '1949', 'raw': 'Corfu (n 40), 17. This term was interpreted by Judge Higgins as a specific (if unclear) standard, see Oil Platforms (n 5), Separate Opinion of Judge Higgins, para 32.', 'footnote_number': 56, 'page_index': 4}, {'citation_type': 'in_text', 'citation_anchor': '(Ronen 2020)', 'context_preceding': '© Yaël Ronen (April 2020)', 'author': 'Ronen', 'year': '2020', 'raw': '© Yaël Ronen (April 2020)', 'footnote_number': None, 'page_index': 5}, {'citation_type': 'footnote', 'citation_anchor': '57', 'context_preceding': '57', 'author': 'Corfu', 'year': '1949', 'raw': 'Corfu (n 40), 16.', 'footnote_number': 57, 'page_index': 5}, {'citation_type': 'footnote', 'citation_anchor': '58', 'context_preceding': '58', 'author': 'Corfu', 'year': '1949', 'raw': 'Corfu (n 40), 17.', 'footnote_number': 58, 'page_index': 5}, {'citation_type': 'footnote', 'citation_anchor': '59', 'context_preceding': '59', 'author': 'Corfu', 'year': '1949', 'raw': 'Corfu (n 40), 16, Oil Platforms (n 5), [71].', 'footnote_number': 59, 'page_index': 5}, {'citation_type': 'footnote', 'citation_anchor': '60', 'context_preceding': '60', 'author': 'Bosnia Genocide', 'year': '2007', 'raw': 'Bosnia Genocide (n 16), [209].', 'footnote_number': 60, 'page_index': 5}, {'citation_type': 'footnote', 'citation_anchor': '61', 'context_preceding': '61', 'author': 'Croatia Genocide', 'year': '2015', 'raw': 'Croatia Genocide (n 42), Separate Opinion of Judge Bhandari para 4.', 'footnote_number': 61, 'page_index': 5}, {'citation_type': 'footnote', 'citation_anchor': '62', 'context_preceding': '62', 'author': 'Oil Platforms', 'year': '2003', 'raw': 'Oil Platforms (n 5), Separate Opinion of Judge Kooijmans, para 56; South West Africa (Ethiopia v South Africa; Liberia v South Africa), ICJ Reports 1962, Joint Dissenting Opinion of Judges Sir Spender and Sir Fitzmaurice, 473, 474; Certain Norwegian Loans, ICJ Reports 1957, Separate Opinion of Judge Sir Lauterpacht, 58.', 'footnote_number': 62, 'page_index': 5}, {'citation_type': 'footnote', 'citation_anchor': '63', 'context_preceding': '63', 'author': 'South West Africa', 'year': '1962', 'raw': 'South West Africa, Joint Dissenting Opinion of Judges Sir Spender and Sir Fitzmaurice, 511.', 'footnote_number': 63, 'page_index': 5}, {'citation_type': 'footnote', 'citation_anchor': '64', 'context_preceding': '64', 'author': 'ICJ', 'year': '1962', 'raw': 'Case concerning the Temple of Preah Vihear (Cambodia v. Thailand), Judgment, ICJ Reports 1962, 21, 58; Case concerning the Aerial Incident of July 27, 1955 (Israel v Bulgaria), ICJ Reports 1959, Joint Dissenting Opinion of Judges Sir Lauterpacht, Wellington Koo and Sir Spender, 162.', 'footnote_number': 64, 'page_index': 5}, {'citation_type': 'footnote', 'citation_anchor': '65', 'context_preceding': '65', 'author': 'Case concerning the Temple of Preah Vihear', 'year': '1962', 'raw': 'Case concerning the Temple of Preah Vihear, (n 64), 55.', 'footnote_number': 65, 'page_index': 5}, {'citation_type': 'footnote', 'citation_anchor': '66', 'context_preceding': '66', 'author': 'Corfu', 'year': '1949', 'raw': 'Corfu (n 40), 18.', 'footnote_number': 66, 'page_index': 5}, {'citation_type': 'footnote', 'citation_anchor': '67', 'context_preceding': '67', 'author': 'Oil Platforms', 'year': '2003', 'raw': 'Oil Platforms (n 5), [61].', 'footnote_number': 67, 'page_index': 5}, {'citation_type': 'footnote', 'citation_anchor': '68', 'context_preceding': '68', 'author': 'Nicaragua', 'year': '2015', 'raw': "Nicaragua (n 16), [54], [110], [159]; ICJ, Certain Activities Carried Out by Nicaragua in the Border Area (Costa Rica v. Nicaragua) and Construction of a Road in Costa Rica along the San Juan River (Nicaragua v. Costa Rica), Judgment, [2015] ICJ Rep 665 para 81, and also para 206. 'Sufficiency' does not seem to be a standard in itself. For example, see the Court’s statement in the Croatia Genocide case, where it notes in the ICTY '[t]he Trial Chamber was sufficiently convinced by that evidence to accept it as proof that Croatian military units and special police carried out killings of Serbs...'. Clearly the term 'sufficiently' means 'as required by the applicable standard' (in the ICTY, 'beyond reasonable doubt'). Croatia Genocide (n 42), [488]. For a statement reflecting the same understanding see Oil Platforms (n 5), Separate Opinion by Judge Buergenthal para 41. On the other hand, in para 44 Judge Buergenthal says that 'the standard of proof has suddenly changed, without an explanation, from ", 'footnote_number': None}, {'citation_type': 'footnote', 'citation_anchor': '69', 'context_preceding': '69', 'author': 'Oil Platforms', 'year': '2003', 'raw': 'Oil Platforms (n 5), [61].', 'footnote_number': 69, 'page_index': 5}, {'citation_type': 'footnote', 'citation_anchor': '70', 'context_preceding': '70', 'author': 'United States Diplomatic and Consular Staff in Tehran', 'year': '1980', 'raw': 'United States Diplomatic and Consular Staff in Tehran, Judgment, [1980] ICJ Rep, [58].', 'footnote_number': 70, 'page_index': 5}, {'citation_type': 'in_text', 'citation_anchor': '(Ronen 2020)', 'context_preceding': '© Yaël Ronen (April 2020)', 'author': 'Ronen', 'year': '2020', 'raw': '© Yaël Ronen (April 2020)', 'footnote_number': None, 'page_index': 6}, {'citation_type': 'footnote', 'citation_anchor': '71', 'context_preceding': '71', 'author': 'Corfu', 'year': '1949', 'raw': 'Corfu (n 40), 17.', 'footnote_number': 71, 'page_index': 6}, {'citation_type': 'footnote', 'citation_anchor': '72', 'context_preceding': '72', 'author': 'Oil Platforms', 'year': '2003', 'raw': "Oil Platforms (n 5), Separate Opinion of Judge Higgins para 33, noting that there is 'a general agreement that the graver the charge the more confidence must there be in the evidence relied on'. In that case, too, the dispute concerned the attributability of the conduct rather than proof of the breach, although not for the purposes of establishing its responsibility but for the purpose of determining whether it was a legitimate target for an act of self defence. Croatia Genocide (n 42), Separate Opinion of Judge Bhandari para 2: 'it is a well-settled principle of law that the graver the offence alleged, the higher the standard of proof required for said offence to be established in a court of law'.", 'footnote_number': 72, 'page_index': 6}, {'citation_type': 'footnote', 'citation_anchor': '73', 'context_preceding': '73', 'author': 'Bosnia Genocide', 'year': '2007', 'raw': 'Bosnia Genocide (n 16), [181], [209]-[210].', 'footnote_number': 73, 'page_index': 6}, {'citation_type': 'footnote', 'citation_anchor': '74', 'context_preceding': '74', 'author': 'Del Mar', 'year': '2012', 'raw': "Katharine del Mar, 'The International Court of Justice and Standards of Proof', The ICJ and the Evolution of International Law: The Enduring Impact of the Corfu Channel Case (Taylor & Francis 2012), 107.", 'footnote_number': 74, 'page_index': 6}, {'citation_type': 'footnote', 'citation_anchor': '75', 'context_preceding': '75', 'author': 'ARSWA', 'year': '2001', 'raw': 'ARSWA art 40', 'footnote_number': 75, 'page_index': 6}, {'citation_type': 'footnote', 'citation_anchor': '76', 'context_preceding': '76', 'author': 'ARSWA', 'year': '2001', 'raw': "ARSWA art 41. Del Mar queries whether and how the standard of proof would differ between allegations of serious breaches of peremptory norms and allegations of 'ordinary' violations. Del Mar (n 74), 116.", 'footnote_number': 76, 'page_index': 6}, {'citation_type': 'in_text', 'citation_anchor': '(Ronen 2020)', 'context_preceding': '© Yaël Ronen (April 2020)', 'author': 'Ronen', 'year': '2020', 'raw': '© Yaël Ronen (April 2020)', 'footnote_number': None, 'page_index': 7}, {'citation_type': 'footnote', 'citation_anchor': '77', 'context_preceding': '77', 'author': 'Tallinn Manual 2.0', 'year': '2017', 'raw': 'Tallinn Manual 2.0 (n 6), 82 para 11.', 'footnote_number': 77, 'page_index': 7}, {'citation_type': 'footnote', 'citation_anchor': '78', 'context_preceding': '78', 'author': 'Dederer and Singer', 'year': '2019', 'raw': "Dederer and Singer (n 39), 445-47. The authors relate the 'gravity' to the conduct 'in deviation from international law', rather than to the original breach to which it responds.", 'footnote_number': 78, 'page_index': 7}, {'citation_type': 'footnote', 'citation_anchor': '79', 'context_preceding': '79', 'author': 'Ronen', 'year': '2020', 'raw': 'leaving aside conduct that would be regarded as use of force because of its consequences, in which case the gravity of the harm would inform the gravity of the breach.', 'footnote_number': 79, 'page_index': 7}, {'citation_type': 'footnote', 'citation_anchor': '80', 'context_preceding': '80', 'author': 'Nachova v Bulgaria', 'year': '2005', 'raw': "Nachova v Bulgaria, Applications nos. 43577/98 and 43579/98 (6 July 2005) para 147 ('The Court is also attentive to the seriousness that attaches to a ruling that a Contracting State has violated fundamental rights').", 'footnote_number': 80, 'page_index': 7}, {'citation_type': 'footnote', 'citation_anchor': '81', 'context_preceding': '81', 'author': 'Del Mar', 'year': '2012', 'raw': 'Del Mar (n 74) 107.', 'footnote_number': 81, 'page_index': 7}, {'citation_type': 'footnote', 'citation_anchor': '82', 'context_preceding': '82', 'author': 'Croatia Genocide', 'year': '2015', 'raw': "As noted by Judge Bhandari on justifying a high standard of proof (and evidentiary standards): '...the crime of genocide, being “an odious scourge” that is “condemned by the civilized world”, carries with it such grievous moral opprobrium that a judicial finding as to its existence can only be countenanced upon the most credible and probative evidence'. Croatia Genocide (n 42), Separate Opinion of Judge Bhandari para 4.", 'footnote_number': 82, 'page_index': 7}, {'citation_type': 'in_text', 'citation_anchor': '(Ronen 2020)', 'context_preceding': '© Yaël Ronen (April 2020)', 'author': 'Ronen', 'year': '2020', 'raw': '© Yaël Ronen (April 2020)', 'footnote_number': None, 'page_index': 8}, {'citation_type': 'footnote', 'citation_anchor': '83', 'context_preceding': '83', 'author': 'Oil Platforms', 'year': '2003', 'raw': 'Oil Platforms (n 5), Separate Opinion by Judge Higgins para 33 (emphasis added).', 'footnote_number': 83, 'page_index': 8}, {'citation_type': 'footnote', 'citation_anchor': '84', 'context_preceding': '84', 'author': 'Bosnia Genocide', 'year': '2007', 'raw': 'In Genocide (n 42), [179] the Court applied the same standard of proof, relying on the similarity of the allegations. The Court did not clarify the conceptual basis for adopting that standard.', 'footnote_number': 84, 'page_index': 8}, {'citation_type': 'footnote', 'citation_anchor': '85', 'context_preceding': '85', 'author': 'Bosnia Genocide', 'year': '2007', 'raw': 'Bosnia Genocide (n 16), [209]-[210].', 'footnote_number': 85, 'page_index': 8}, {'citation_type': 'footnote', 'citation_anchor': '86', 'context_preceding': '86', 'author': 'Gattini', 'year': '2007', 'raw': 'Gattini (n 42), 899. In terms of the harm caused, failure to prevent is no less grave than commission. Admittedly, the harm caused by failure to punish is smaller. However, the Court did not make that distinction so there is no reason to believe that harm was a relevant factor in its view.', 'footnote_number': 86, 'page_index': 8}, {'citation_type': 'footnote', 'citation_anchor': '87', 'context_preceding': '87', 'author': 'Oil Platforms', 'year': '2003', 'raw': 'Oil Platforms (n 5), Separate Opinion of Judge Kooijmans, para 54.', 'footnote_number': 87, 'page_index': 8}, {'citation_type': 'in_text', 'citation_anchor': '(Ronen 2020)', 'context_preceding': '© Yaël Ronen (April 2020)', 'author': 'Ronen', 'year': '2020', 'raw': '© Yaël Ronen (April 2020)', 'footnote_number': None, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '88', 'context_preceding': 'respond through use of force.', 'author': 'ICC Statute', 'year': '2003', 'raw': 'Illegal use of force may constitute the crime of aggression under the ICC Statute. However, not only was this not part of the law in 2003; the conduct in question would not have qualified as a crime of aggression even under the present law.', 'footnote_number': 88, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '89', 'context_preceding': 'same direction, but there may be exceptions. Cyber operations may be a case in point.', 'author': 'Amerasinghe', 'year': '2020', 'raw': 'Amerasinghe (n 33) 234.', 'footnote_number': 89, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '90', 'context_preceding': 'evidence was not ‘conclusive’ or led to ‘no firm conclusion’.', 'author': 'ICJ', 'year': '1949', 'raw': 'Both terms in Corfu (n 40), 17.', 'footnote_number': 90, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '91', 'context_preceding': 'provided that they leave no room for reasonable doubt’.', 'author': 'ICJ', 'year': '1949', 'raw': 'Corfu (n 40), 18.', 'footnote_number': 91, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '92', 'context_preceding': 'that ‘claims against a State involving charges of exceptional gravity must be proved by evidence that is fully conclusive’.', 'author': 'ICJ', 'year': '2007', 'raw': 'Bosnia Genocide (n 16), [209], citing (albeit ‘cf.’) the Corfu Channel case. In Application of the Convention on the Prevention and Punishment of the Crime of Genocide (Croatia v. Serbia), Judgment [2015] ICJ Rep 3 para 179, the Court applied the same standard of proof, relying on the similarity of the allegations', 'footnote_number': 92, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '93', 'context_preceding': 'because they were ‘not conclusively shown’.', 'author': 'ICJ', 'year': '2007', 'raw': 'Bosnia Genocide (n 16), [388].', 'footnote_number': 93, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '94', 'context_preceding': 'because they were ‘not conclusively shown’.', 'author': 'ICJ', 'year': '2007', 'raw': 'Bosnia Genocide (n 16), [422]-[423].', 'footnote_number': 94, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '95', 'context_preceding': 'that ‘conclusiveness’ and absence of ‘reasonable doubt’ were comparable terms.', 'author': 'H.E. Judge Rosalyn Higgins', 'year': '2007', 'raw': 'Speech by H.E. Judge Rosalyn Higgins, President of the International Court of Justice, to the Sixth Committee of the General Assembly, 2 November 2007, 5. In the Croatia Genocide (2015) case the Court maintained this interchangeability.', 'footnote_number': 95, 'page_index': None}, {'citation_type': 'in_text', 'citation_anchor': '(Ronen 2020)', 'context_preceding': '© Yaël Ronen (April 2020)', 'author': 'Ronen', 'year': '2020', 'raw': '© Yaël Ronen (April 2020)', 'footnote_number': None, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '96', 'context_preceding': 'and in the Ireland v UK case (1978) (alleging conduct constituting torture).', 'author': 'European Commission and the European Court of Human rights (ECtHR)', 'year': '1969', 'raw': 'The European Commission and the European Court of Human Rights 1969 Yearbook of the European Convention on Human Rights, (Martinus Nijhoff 1972) Greek Case, 1, 196 (Chapter IV para 30).', 'footnote_number': 96, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '97', 'context_preceding': 'The Court also enunciated this as the applicable standard in the Varnava v Turkey case (2009) (alleging conducting amount to enforced disappearances).', 'author': 'ECtHR', 'year': '1978', 'raw': 'ECtHR, Ireland v United Kingdom (Application No. 5310/71), Judgement, para 161.', 'footnote_number': 97, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '98', 'context_preceding': 'One explanation for the choice of the ‘beyond reasonable doubt’ standard may that all cases concerned systematic violations of non-derogable rights amounting to international crimes (although not ones susceptible in practice to prosecution in an international tribunal).', 'author': 'ECtHR', 'year': '2009', 'raw': 'Varnava (n 29) para 182. (‘[T]he Court would concur that the standard of proof generally applicable in individual applications is that of beyond reasonable doubt’).', 'footnote_number': 98, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '99', 'context_preceding': 'the Court did not intend to borrow the approach of the national legal systems that use that standard, since its role is not to rule on criminal guilt or civil liability but to ensure the observance by Contracting States’ of their obligation to secure rights under the Convention.', 'author': 'ICJ', 'year': '2005', 'raw': 'Nachova v Bulgaria, Applications nos. 43577/98 and 43579/98 (6 July 2005) para 147.', 'footnote_number': 99, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '100', 'context_preceding': 'Shelton suggests that the ECtHR’s recourse to the ‘beyond reasonable doubt’ standard was influenced by the fact that interstate complaints are always suspect of political motivation, and therefore merit the highest standard of proof.', 'author': 'Kinsch', 'year': '2009', 'raw': 'Kinsch (2009) 436.', 'footnote_number': 100, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '101', 'context_preceding': "However, in the Varnava case the 'beyond reasonable doubt' standard was applied in the individual application, and the ECtHR rejected the proposed distinction.", 'author': 'Shelton', 'year': '2009', 'raw': 'Shelton (n 13) 386.', 'footnote_number': 101, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '102', 'context_preceding': 'According to Judge Cançado Trindad, the ‘beyond reasonable doubt’ standard as used by the ECHR was endowed with an autonomous meaning under the European Convention on Human', 'author': 'Varnava', 'year': '2009', 'raw': 'Varnava (n 29) para 182.', 'footnote_number': 102, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '103', 'context_preceding': 'the evidence ‘leaves a substantial degree of doubt’, Croatia Genocide (n 42), [483].', 'author': 'ICJ', 'year': '2015', 'raw': 'After declaring that it would apply the same standard of proof as in Bosnia Genocide (n 16) (namely ‘to be fully convinced’), [178]-[179], the Court held with regards to facts constituting the actus reus of genocide, that the evidence ‘leaves a substantial degree of doubt’, Croatia Genocide (n 42), [483]. The synonymity of ‘beyond reasonable doubt’ and ‘conclusive’ evidence was made explicit in an entirely different context, in the Joint Dissenting Opinion of Judges Sir Percy Spender and Sir Gerald Fitzmaurice, South West Africa Cases (Ethiopia v. South Africa; Liberia v. South Africa), Preliminary Objections, Judgment of 21 December 1962, [1962] ICJ Rep 319, 473, stating that the Court’s jurisdiction in a contentious case ‘must be established conclusively’ and therefore ‘it is for the Applicants to [establish their claim] beyond reasonable doubt’, and that similarly ‘a duty lies upon the Court, before it may assume jurisdiction, to be conclusively satisfied - satisfied beyond a reasonable doubt - that jurisdiction does exist’.', 'footnote_number': 103, 'page_index': None}, {'citation_type': 'in_text', 'citation_anchor': '(Ronen 2020)', 'context_preceding': '© Yaël Ronen (April 2020)', 'author': 'Ronen', 'year': '2020', 'raw': '© Yaël Ronen (April 2020)', 'footnote_number': None, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '104', 'context_preceding': 'O’Connell argues that the ‘beyond reasonable doubt’ standard has lost its prominence in the ECtHR, but the Varnava case suggests that this view may have been premature.', 'author': 'Varnava', 'year': '2009', 'raw': 'Varnava (n 29) para 182.', 'footnote_number': 104, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '105', 'context_preceding': 'The Court did not actually require proof beyond reasonable doubt in that case.', 'author': 'Varnava', 'year': '2009', 'raw': 'Varnava (n 29) para 185. For a critique of both the adoption of the ‘beyond reasonable doubt’ standard and its purported application in the circumstances see the dissenting opinion of Judge Erönen.', 'footnote_number': 105, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '106', 'context_preceding': 'Other cases in the ECtHR explicitly applied a lower standard for the burden of proof.', 'author': 'ECHR', 'year': '1983', 'raw': 'Pakelli v Germany, ECHR (1983) para 34.', 'footnote_number': 106, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '107', 'context_preceding': 'The ‘beyond reasonable doubt’ standard has also featured in some judgments of the IUSCT.', 'author': 'IUSCT', 'year': '1986', 'raw': 'Amerasinghe (n 33), 237; Mojtaba Kazazi, Burden of Proof and Its Related Issues: A Study on Evidence before International Tribunals (Kluwer Law International 1996) 395, citing Oil Field of Texas, Inc v. Iran, Award No. 258-43-1 (8 October 1986), reprinted in 12 Iran-U.S. C.T.R. 308, 315. Kazazi holds that this case is an exception in the practice of the Court.', 'footnote_number': 107, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '108', 'context_preceding': 'But not every alleged violation of a peremptory norm would necessary entail application of this standard.', 'author': 'Trail Smelter Case', 'year': '1941', 'raw': 'Trail Smelter (U.S. v. Canada), 3 RIAA 1905, 1963-1965 (1941).', 'footnote_number': 108, 'page_index': None}, {'citation_type': 'in_text', 'citation_anchor': '(Ronen 2020)', 'context_preceding': '© Yaël Ronen (April 2020)', 'author': 'Ronen', 'year': '2020', 'raw': '© Yaël Ronen (April 2020)', 'footnote_number': None, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '109', 'context_preceding': 'With regard to other cases, such as the Oil Platforms case (2003) and the Nicaragua case (1986), O’Connell infers that the ICJ favored the ‘clear and convincing’ standard from the fact that it demanded more than mere preponderance of the evidence to support claims of the United States that it acted in self-defense, but did not require the United States had to provide proof beyond a reasonable doubt.', 'author': 'Congo v Uganda', 'year': '2005', 'raw': 'Armed Activities on the Territory of the Congo (n 54), [72], [83], [91].', 'footnote_number': 109, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '110', 'context_preceding': 'O’Connell claims that ‘clear and convincing’ is an emerging general standard under international law, including or especially with regard to justification of the use of force in self defence.', 'author': 'Eritrea-Ethiopia Claims Commission', 'year': '2005', 'raw': "Eritrea-Ethiopia Claims Commission: Partial Award — Jus Ad Bellum, Ethiopia's Claims 1-8 (19 Dec 2005) para 12.", 'footnote_number': 110, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '111', 'context_preceding': 'In addition to judicial decisions she relies on numerous US statements given outside judicial proceedings, which consistently refer to ‘compelling’ or ‘convincing’ evidence as grounds for decisions whether to respond by force to alleged acts of terrorism.', 'author': "O'Connell", 'year': '2006', 'raw': 'Mary Ellen O’Connell, ‘Rules of Evidence for the Use of Force in International Law’s New Era’ (2006) 100 American Society of International Law Proceedings 44, 45. See also Green (n 9) 172-74, referring to ICJ jurisprudence.', 'footnote_number': 111, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '112', 'context_preceding': 'O’Connell and Henkin furthermore advocate the ‘clear and convincing’ standard with regard to the use of force in self defence as a matter of policy, on the grounds that a high standard of proof is needed to counter the potential for abuse of the right to self defence.', 'author': "O'Connell", 'year': '2002', 'raw': 'O’Connell (n 111) 46-47.', 'footnote_number': 112, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '113', 'context_preceding': 'Lobel advocates the ‘beyond reasonable doubt’ standard, at least in relation to a state seeking to justify the use of force in self defence (rather than in relation to determining state responsibility in judicial proceedings).', 'author': 'Henkin', 'year': '2002', 'raw': "Mary Ellen O’Connell, ‘Evidence of Terror’ (2002) 7 Journal of Conflict and Security Law 19, 23, also in the 2006 article, 46 Henkin (advocating ‘clear and convincing’ rather than 'preponderance').", 'footnote_number': 113, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '114', 'context_preceding': 'He regards the lower standard as an undesirable but necessary concession.', 'author': 'Lobel', 'year': '2009', 'raw': 'Lobel (n 10), 551. Lobel does not mention attribution as such, but the question with which he is concerned is the attribution of the Kenya and Tanzania 1998 embassy attacks to Bin Laden and therefore to Afghanistan (training facility controlled by Bin Laden) and Sudan (pharmaceutical plant linked to Bin Laden), as well as expectation of future attack (proof of breach).', 'footnote_number': 114, 'page_index': None}, {'citation_type': 'in_text', 'citation_anchor': '(Ronen 2020)', 'context_preceding': '© Yaël Ronen (April 2020)', 'author': 'Ronen', 'year': '2020', 'raw': '© Yaël Ronen (April 2020)', 'footnote_number': None, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '115', 'context_preceding': 'This has been interpreted as a lower standard than ‘beyond reasonable doubt’.', 'author': 'Velásquez Rodríguez', 'year': '1988', 'raw': 'Velásquez Rodríguez (n 3) para 129.', 'footnote_number': 115, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '116', 'context_preceding': 'Similarly, the Ethiopia-Eritrea Commission held that ‘[p]articularly in light of the gravity of some of the claims advanced, the Commission will require clear and convincing evidence in support of its findings’.', 'author': 'Buergenthal', 'year': '1988', 'raw': 'Buergenthal held that the standard lies somewhere between proof beyond a reasonable doubt and proof on the preponderance of evidence. Thomas Buergenthal, ‘Judicial Fact-Finding: The Inter-American Human Rights Court’, in Lillich (n 4) 261, 272. Judge Buergenthal sat on the case. See also Shelton (n 17). O’Connell (n 113) 19 holds that the standard applied was ‘clear and convincing’; but also Linda Drucker, ‘Governmental Liability for Disappearances: A Landmark Ruling by the Inter-American Court of Human Rights Recent Development’ (1988) 25 Stanford Journal of International Law 289, 306.', 'footnote_number': 116, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '117', 'context_preceding': 'Amerasinghe nonetheless notes that there have been cases which used the ‘convincing’ standard interchangeably with ‘beyond reasonable doubt’.', 'author': 'Eritrea-Ethiopia Claims Commission', 'year': '2003', 'raw': "Eritrea-Ethiopia Claims Commission, Partial Award: Prisoners of War - Eritrea's Claim 17 (1 July 2003) XXVI RIAA 23 para 4; Eritrea-Ethiopia Claims Commission, Partial Award: Prisoners of War - Ethiopia's Claim 4 (1 July 2003) RIAA vol XXVI 73-1141 para 37.", 'footnote_number': 117, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '118', 'context_preceding': 'He suggests that this interchangeability also underpins the Velásquez Rodríguez case.', 'author': 'Amerasinghe', 'year': '2020', 'raw': 'Amerasinghe (n 33), 240.', 'footnote_number': 118, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '119', 'context_preceding': 'Since the exact meaning of that standard ultimately depends on how each particular tribunal views the matter, arguably the formal distinctions might be largely semantic', 'author': 'Buergenthal', 'year': '1988', 'raw': 'Buergenthal (n 116), 272.', 'footnote_number': 119, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '120', 'context_preceding': 'Shelton considers that the ‘clear and convincing’ standard is appropriate where systematic and serious violations of human rights are alleged in individual petitions.', 'author': 'Shelton', 'year': '2009', 'raw': 'Shelton (n 13) 386.', 'footnote_number': 120, 'page_index': None}, {'citation_type': 'in_text', 'citation_anchor': '(Ronen 2020)', 'context_preceding': '© Yaël Ronen (April 2020)', 'author': 'Ronen', 'year': '2020', 'raw': '© Yaël Ronen (April 2020)', 'footnote_number': None, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '121', 'context_preceding': '‘Preponderance of evidence’ generally means that there is evidence greater in weight in comparison with the evidence adduced by the other party on the basis of reasonable probability rather than possibility.', 'author': 'Rüdiger Wolfrum', 'year': '2013', 'raw': 'Various commentators hold that the standard of proof most commonly used in international litigation is that of preponderance of evidence. Rüdiger Wolfrum, Mirka Möldner, ‘International Courts and Tribunals, Evidence’ Max Planck Encyclopedia of International Law (MPEPIL) 26 (August 2013) MN 77; Amerasinghe (n 33).', 'footnote_number': 121, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '122', 'context_preceding': 'However, ICJ case law relating to state', 'author': 'Rüdiger Wolfrum', 'year': '2013', 'raw': 'Rüdiger Wolfrum, Mirka Möldner, ‘International Courts and Tribunals, Evidence’ Max Planck Encyclopedia of International Law (MPEPIL) 26 (August 2013) MN 77; Amerasinghe (n 33).', 'footnote_number': 122, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '123', 'context_preceding': 'Notably, the case law in which a specific standard was applied, namely ‘clear and convincing evidence’, concerned alleged violations of the prohibition on the use of force.', 'author': 'Amerasinghe', 'year': '2020', 'raw': 'Amerasinghe (n 33), 241 and cases cited there.', 'footnote_number': 123, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '124', 'context_preceding': 'Notably, the case law in which a specific standard was applied, namely ‘clear and convincing evidence’, concerned alleged violations of the prohibition on the use of force.', 'author': 'Pulp Mills', 'year': '2010', 'raw': 'Pulp Mills (n 16), Separate Opinion of Judge Greenwood, para 26; Oil Platforms (n 5), Separate Opinion of Judge Buregenthal.', 'footnote_number': 124, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '125', 'context_preceding': 'Just as a higher standard is applicable in some cases of even greater gravity, it may be that the ‘preponderance of evidence’ would be deemed appropriate in cases of lower gravity.', 'author': 'Shelton', 'year': '2009', 'raw': 'Shelton (n 13) 386.', 'footnote_number': 125, 'page_index': None}, {'citation_type': 'in_text', 'citation_anchor': '(Ronen 2020)', 'context_preceding': '© Yaël Ronen (April 2020)', 'author': 'Ronen', 'year': '2020', 'raw': '© Yaël Ronen (April 2020)', 'footnote_number': None, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '126', 'context_preceding': 'The need to prove identity and conduct with regard to cyber operations presents novel evidentiary challenges, as the internet was never designed for tracking and tracing users.', 'author': 'Finlay and Payne', 'year': '2019', 'raw': 'Lorraine Finlay and Christine Payne, ‘The Attribution Problem and Cyber Armed Attacks’ (2019) AJIL 202, 203-204; Rid and B Buchanan, ‘Attributing Cyber Attacks’ (2015) 38 Journal of Strategic Studies 4, 32.', 'footnote_number': 126, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '127', 'context_preceding': 'Specifically when at issue is a potential response to an attack through use of force, it has been argued that the time it will realistically take to correctly identify the perpetrator will make it significantly harder for a state to satisfy the factors of immediacy and necessity required to lawfully exercise its right of self-defense.', 'author': 'Roscini', 'year': '2015', 'raw': 'Marco Roscini, ‘Evidentiary Issues in International Disputes Related to State Responsibility for Cyber Operations’ in Jens David Ohlin, Kevin Govern and Claire Finkelstein (eds), Cyber War: Law and Ethics for Virtual Conflicts (2015) 215, 229 and sources therein.', 'footnote_number': 127, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '128', 'context_preceding': 'Specifically when at issue is a potential response to an attack through use of force, it has been argued that the time it will realistically take to correctly identify the perpetrator will make it significantly harder for a state to satisfy the factors of immediacy and necessity required to lawfully exercise its right of self-defense.', 'author': 'Finlay and Payne', 'year': '2019', 'raw': 'Finlay and Payne(n 126), 204.', 'footnote_number': 128, 'page_index': None}, {'citation_type': 'in_text', 'citation_anchor': '(Ronen 2020)', 'context_preceding': '© Yaël Ronen (April 2020)', 'author': 'Ronen', 'year': '2020', 'raw': '© Yaël Ronen (April 2020)', 'footnote_number': None, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '129', 'context_preceding': 'However, attribution is not a formality.', 'author': 'Jensen', 'year': '2002', 'raw': 'Eric Talbot Jensen, ‘Computer Attacks on Critical National Infrastructure: A Use of Force Invoking the Right of Self-Defense’ (2002) 38 Stanford Journal of International Law 207.', 'footnote_number': 129, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '130', 'context_preceding': 'Without attribution, against whom would the conduct in self defense be directed', 'author': 'Unknown', 'year': 'Unknown', 'raw': 'Without attribution, the attacked state may be able to take measures that are otherwise unlawful, if it can invoke necessity as a circumstance precluding wrongfulness. However, in addition to the extremely strict requirements that must be met in order invoke necessity (Henning Lahmann, Unilateral Remedies to Cyber Operations Self-Defence, Countermeasures, Necessity and the Question of Attribution (2020, on file with the author) 154-198), it is not settled that it precludes the wrongfulness of the use of force (Tallinn Manual 2.0 (n 6), 140 para 18).', 'footnote_number': 130, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '131', 'context_preceding': 'That said, the very notion of ‘standard of proof’ constitutes a compromise between absolute certainty and practicality.', 'author': 'Roscini', 'year': '2015', 'raw': 'Roscini (n 127), 229; Dederer and Singer (n 39),448.', 'footnote_number': 131, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '132', 'context_preceding': 'As the type of acts that need to be proven, and the means of proving them, evolve to new realms, this perception may need adaptation; the proposition that the standards might need modification is not entirely misplaced.', 'author': 'Declaration of Vice-President Ranjeva', 'year': 'Unknown', 'raw': 'For a similar sentiment see Declaration of Vice-President Ranjeva in Arena (n 16), para 2.', 'footnote_number': 132, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '133', 'context_preceding': 'As the type of acts that need to be proven, and the means of proving them, evolve to new realms, this perception may need adaptation; the proposition that the standards might need modification is not entirely misplaced.', 'author': 'Margulies', 'year': '2019', 'raw': 'Margulies (n 38), 504; William C Banks, ‘The Bumpy Road to a Meaningful International Law of Cyber Attribution’ (2019) 113 AJIL Unbound 191, 192.', 'footnote_number': 133, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '134', 'context_preceding': 'As the type of acts that need to be proven, and the means of proving them, evolve to new realms, this perception may need adaptation; the proposition that the standards might need modification is not entirely misplaced.', 'author': 'Finlay and Payne', 'year': '2019', 'raw': 'Finlay and Payne (n 126), 204.', 'footnote_number': 134, 'page_index': None}, {'citation_type': 'in_text', 'citation_anchor': '(Ronen 2020)', 'context_preceding': '© Yaël Ronen (April 2020)', 'author': 'Ronen', 'year': '2020', 'raw': '© Yaël Ronen (April 2020)', 'footnote_number': None, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '135', 'context_preceding': 'This approach was explained by ICJ Former President Rosalyn Higgins on the ground that ‘[t]he parties are entitled to expect that we will examine every single thing that they put before us, and we do’.', 'author': 'H.E. Judge Rosalyn Higgins', 'year': '2007', 'raw': 'Speech by H.E. Judge Rosalyn Higgins, President of the International Court of Justice, to the 62nd Session of the General Assembly 1 November 2007 in Dame Rosalyn Higgins, Themes and Theories: Selected Essays, Speeches, and Writings in International Law (Oxford University Press 2009) 1378, 1379.', 'footnote_number': 135, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '136', 'context_preceding': 'This approach was explained by ICJ Former President Rosalyn Higgins on the ground that ‘[t]he parties are entitled to expect that we will examine every single thing that they put before us, and we do’.', 'author': 'Charles N Brower', 'year': '1994', 'raw': 'Charles N Brower, ‘Evidence before International Tribunals: The Need for Some Standard Rules’ (1994) 28 International Lawyer 47.', 'footnote_number': 136, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '137', 'context_preceding': 'Alongside the liberal policy of admissibility, through the case law the ICJ has established principles on the relative probative value and reliability that it would attach to different categories of evidence.', 'author': 'United States Diplomatic and Consular Staff in Tehran', 'year': '1980', 'raw': 'United States Diplomatic and Consular Staff in Tehran (n 70), [11]-[13]; Nicaragua (n 16), [59]-[73]; Armed Activities on the Territory of the Congo (n 54), [57]-[61].', 'footnote_number': 137, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '138', 'context_preceding': 'Alongside the liberal policy of admissibility, through the case law the ICJ has established principles on the relative probative value and reliability that it would attach to different categories of evidence.', 'author': 'Anna Riddell and Brendan Plant', 'year': '2016', 'raw': 'Anna Riddell and Brendan Plant, Evidence before the International Court of Justice (British Institute of International and Comparative Law 2016), 192.', 'footnote_number': 138, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '139', 'context_preceding': 'Alongside the liberal policy of admissibility, through the case law the ICJ has established principles on the relative probative value and reliability that it would attach to different categories of evidence.', 'author': 'Corfu', 'year': '1949', 'raw': 'Corfu (n 40), 21 (the Court ‘could not fail to give great weight to the opinion of the experts who acted in a manner giving every guarantee of correct and impartial information’).', 'footnote_number': 139, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '140', 'context_preceding': 'proceedings, or is neutral and indifferent, and whether the evidence contains any admissions against the interest of the party submitting it.', 'author': 'Nicaragua', 'year': '1964', 'raw': 'Nicaragua (n 16), [64], [69]-[70]; Armed Activities on the Territory of the Congo (n 54), [78]-[79]; Bosnia Genocide (n 16), [448]; Brower (n 136), 54.', 'footnote_number': 140, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '141', 'context_preceding': 'hearsay. Method: the means and methodology by which the information presented has been collected.', 'author': 'Nicaragua', 'year': '1968', 'raw': "Nicaragua (n 16), [68], referring to Corfu (n 40), 17); Armed Activities on the Territory of the Congo (n 54), [61] ('It will prefer contemporaneous evidence from persons with direct knowledge'); Croatia Genocide (n 42), [196] ('In determining the evidential weight of any statement by an individual, the Court necessarily takes into account its form and the circumstances in which it was made'), [217].", 'footnote_number': 141, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '142', 'context_preceding': 'Verification: evidence will be considered to be more valuable if it has been subject to cross-examination either during its compilation or subsequently, and if it is corroborated by other sources.', 'author': 'Armed Activities on the Territory of the Congo', 'year': '1954', 'raw': 'Armed Activities on the Territory of the Congo (n 54), [61]; Bosnia Genocide (n 16), [213], [214]-[224].', 'footnote_number': 142, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '143', 'context_preceding': 'Contemporaneity: generally less weight attaches to evidence which was not prepared or given at a time close to the facts it purports to prove. Equally, more caution is due with respect to documents prepared specifically for the purposes of litigation.', 'author': 'Armed Activities on the Territory of the Congo', 'year': '1954', 'raw': 'Armed Activities on the Territory of the Congo (n 54), [61]; Bosnia Genocide (n 16), [213]. In the IUSCT, contemporaneous written exchanges of the parties antedating the dispute are the most reliable source of evidence. Brower (n 136), 54.', 'footnote_number': 143, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '144', 'context_preceding': 'Procedure: whether the evidence was correctly submitted in accordance with procedural requirements.', 'author': 'Application of the International Convention on the Elimination of All Forms of Racial Discrimination (Georgia v. Russian Federation)', 'year': '2011', 'raw': 'Application of the International Convention on the Elimination of All Forms of Racial Discrimination (Georgia v. Russian Federation), Preliminary Objections, [2011] Judgment, ICJ Rep 70 Separate Opinion of Judge Simma, paras 20-21.', 'footnote_number': 144, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '145', 'context_preceding': "In 2011 the Court introduced the concept of 'legal significance'. It denied such significance (ie probative value) to documents based on of formality, authorship, inaction, attribution, and notice. This has been harshly criticized by Judge Simma.", 'author': 'Velásquez Rodríguez', 'year': '1988', 'raw': 'Velásquez Rodríguez (n 3), para 130, 138; Varnava (n 29) para 183.', 'footnote_number': 145, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '146', 'context_preceding': "In 2011 the Court introduced the concept of 'legal significance'. It denied such significance (ie probative value) to documents based on of formality, authorship, inaction, attribution, and notice. This has been harshly criticized by Judge Simma.", 'author': 'Foster', 'year': '2003', 'raw': 'Foster (n 3) 48.', 'footnote_number': 146, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '147', 'context_preceding': 'in the exclusive control of the state, and that state does not cooperate in bringing forth that evidence, the victim state would be allowed a more liberal recourse to circumstantial evidence, including inferences of fact.', 'author': 'Corfu', 'year': '1940', 'raw': 'Corfu (n 40), 18.', 'footnote_number': 147, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '148', 'context_preceding': 'In human rights tribunals, an additional justifications for use of indirect evidence is the imbalance of power between the parties in cases based on individual applications. Individuals lack both the resources and the power of the defendant state.', 'author': 'Shelton', 'year': '2013', 'raw': 'Shelton (n 13).', 'footnote_number': 148, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '149', 'context_preceding': 'In human rights tribunals, an additional justifications for use of indirect evidence is the imbalance of power between the parties in cases based on individual applications. Individuals lack both the resources and the power of the defendant state.', 'author': 'Velásquez Rodríguez', 'year': '1988', 'raw': 'Velásquez Rodríguez (n 3), para 131.', 'footnote_number': 149, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '150', 'context_preceding': 'A factual inference is the drawing of a factual conclusion from a fact already established. A factual presumption is an inference based on repeated practice. Factual presumptions relieve the reliant party from proving a fact it alleges but cannot prove directly, by relying on an inference from a fact that it can prove directly. When no evidence is presented against the presumption or inference, the other party is then required to disprove them.', 'author': 'Kazazi', 'year': '2004-2005', 'raw': 'Kazazi 424-425, Foster (n 3) 49.', 'footnote_number': 150, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '151', 'context_preceding': 'The ICJ has made some use of inferences. It did so extensively in the Nicaragua case (1986), where the US did not participate in the proceedings and did not offer its own version of the facts.', 'author': 'Keith Highet', 'year': '1987', 'raw': "Keith Highet, 'Evidence, the Court, and the Nicaragua Case' (1987) 81 American Journal of International Law 1.", 'footnote_number': 151, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '152', 'context_preceding': 'The ICJ has made some use of inferences. It did so extensively in the Nicaragua case (1986), where the US did not participate in the proceedings and did not offer its own version of the facts.', 'author': 'Bosnia Genocide', 'year': '2007', 'raw': 'Bosnia Genocide (n 16), [373].', 'footnote_number': 152, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '153', 'context_preceding': "In contrast, in the Georgia v Russia case (2011) Judge Simma in a separate opinion strongly criticised the majority for factual using inferences that 'undermine the Court’s responsibility to discharge its judicial function in a thorough manner by making full use of its fact-finding powers under Articles 49 to 51 of the Statute to avoid having to resort to such inferences in the first place'.", 'author': 'Application of CERD', 'year': '2011', 'raw': 'Application of CERD (n 144), Separate Opinion of Judge Simma para 21.', 'footnote_number': 153, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '154', 'context_preceding': 'The IUSCT has made use of factual inferences. In the international human rights tribunals inferences and presumptions have played an important role. The ECtHR has held that where the events in issue lie wholly, or in large part, within the exclusive knowledge of the authorities, as in the case of persons within their control in custody, strong presumptions of fact will arise in respect of injuries, death or disappearances occurring during such detention.', 'author': 'Judge Howard M Holzmann', 'year': '2011', 'raw': "For case law see Judge Howard M Holzmann, 'Fact-Finding by the Iran-United States Claims Tribunal' in Lillich (n 4) 101, 114-17.", 'footnote_number': 154, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '155', 'context_preceding': 'The IUSCT has made use of factual inferences. In the international human rights tribunals inferences and presumptions have played an important role. The ECtHR has held that where the events in issue lie wholly, or in large part, within the exclusive knowledge of the authorities, as in the case of persons within their control in custody, strong presumptions of fact will arise in respect of injuries, death or disappearances occurring during such detention.', 'author': 'Varnava', 'year': '2029', 'raw': 'Varnava (n 29) para 183 citing numerous previous judgements.', 'footnote_number': 155, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '156', 'context_preceding': 'A specific inference that has been applied in courts and tribunal is the inference from silence - acceptance of the veracity of factual claims when the adversary offers no denial.', 'author': 'Highet', 'year': '1951', 'raw': 'Highet (n 151), 33.', 'footnote_number': 156, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '157', 'context_preceding': 'A specific inference that has been applied in courts and tribunal is the inference from silence - acceptance of the veracity of factual claims when the adversary offers no denial.', 'author': 'United States Diplomatic and Consular Staff in Tehran', 'year': '1980', 'raw': 'United States Diplomatic and Consular Staff in Tehran (n 137).', 'footnote_number': 157, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '158', 'context_preceding': 'A specific inference that has been applied in courts and tribunal is the inference from silence - acceptance of the veracity of factual claims when the adversary offers no denial.', 'author': 'Velásquez Rodríguez', 'year': '1988', 'raw': 'Velásquez Rodríguez (n 3), para 138.', 'footnote_number': 158, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '159', 'context_preceding': 'A specific inference that has been applied in courts and tribunal is the inference from silence - acceptance of the veracity of factual claims when the adversary offers no denial.', 'author': 'Velásquez Rodríguez', 'year': '1988', 'raw': 'Velásquez Rodríguez (n 3), para 183.', 'footnote_number': 159, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '160', 'context_preceding': 'A specific inference that has been applied in courts and tribunal is the inference from silence - acceptance of the veracity of factual claims when the adversary offers no denial.', 'author': 'IAComHR RoP', 'year': '2009', 'raw': "OAS, 'IAComHR RoP' (2009) art 38.", 'footnote_number': 160, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '161', 'context_preceding': 'A party’s refusal to provide information that is in its exclusive possession may, in some instances, lead the tribunal to draw adverse inferences.', 'author': 'Bosnia Genocide', 'year': '2016', 'raw': 'Bosnia Genocide (n 16), [204].', 'footnote_number': 161, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '162', 'context_preceding': 'A party’s refusal to provide information that is in its exclusive possession may, in some instances, lead the tribunal to draw adverse inferences.', 'author': 'Bosnia Genocide', 'year': '2016', 'raw': 'Bosnia Genocide (n 16), [206].', 'footnote_number': 162, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '163', 'context_preceding': 'A party’s refusal to provide information that is in its exclusive possession may, in some instances, lead the tribunal to draw adverse inferences.', 'author': 'Bosnia Genocide', 'year': '2016', 'raw': 'Bosnia Genocide (n 16), Dissenting Opinion of Judge Al Khasawne, para 35.', 'footnote_number': 163, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '164', 'context_preceding': 'The power to draw adverse inferences from a refusal to provide information is explicit under instruments of some other courts and tribunals.', 'author': 'WTO', 'year': '1994', 'raw': "In the WTO, the SCM Agreement provides that '[i]n making its determination, the Panel should draw adverse inferences from instances of non-cooperation by any person involved in the information gathering process'.", 'footnote_number': 164, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '165', 'context_preceding': 'The power to draw adverse inferences from a refusal to provide information is explicit under instruments of some other courts and tribunals.', 'author': 'ECtHR', 'year': '1971', 'raw': 'eg ECtHR, Ireland v United Kingdom (Application No. 5310/71) Judgment, para 161.', 'footnote_number': 165, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '166', 'context_preceding': 'The power to draw adverse inferences from a refusal to provide information is explicit under instruments of some other courts and tribunals.', 'author': 'Kazazi', 'year': '2007', 'raw': 'Kazazi (n 107), 429.', 'footnote_number': 166, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '167', 'context_preceding': 'The power to draw adverse inferences from a refusal to provide information is explicit under instruments of some other courts and tribunals.', 'author': 'Gattini', 'year': '2004', 'raw': 'Gattini (n 42), 891.', 'footnote_number': 167, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '168', 'context_preceding': 'The proposition that the burden of proof should be alleviated by use of indirect evidence is particularly germane in proving cyber operations, a process which require access to information that is in the exclusive control of other states. Presumptions and inferences may also be applicable. Dederer and Singer, for example, suggest that when an operation has definitely been launched from a state’s computer system located within a state-owned or state-controlled facility, the victim state can be regarded as having conclusively established that the cyber operation is attributable to a state organ within the meaning of ARSIWA Article 4.', 'author': 'Dederer and Singer', 'year': '2019', 'raw': 'Dederer and Singer (n 39), 454.', 'footnote_number': 168, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '169', 'context_preceding': 'The proposition that the burden of proof should be alleviated by use of indirect evidence is particularly germane in proving cyber operations, a process which require access to information that is in the exclusive control of other states. Presumptions and inferences may also be applicable. Dederer and Singer, for example, suggest that when an operation has definitely been launched from a state’s computer system located within a state-owned or state-controlled facility, the victim state can be regarded as having conclusively established that the cyber operation is attributable to a state organ within the meaning of ARSIWA Article 4.', 'author': 'Tallinn Manual 2.0', 'year': '2016', 'raw': 'Tallinn Manual 2.0 (n 6), 91 para 13.', 'footnote_number': 169, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '170', 'context_preceding': 'Proving cyber operations may involve the use of novel types of evidence. Given the liberal approach of courts and tribunals to admission of evidence, this novelty does not in itself seem to present particular challenges. For example, there is likely to be a significant amount of digital evidence. The use of such evidence in inter-state litigation has been almost entirely neglected by international law scholarship, with the exception of studies of the use of digital evidence before criminal tribunals.', 'author': 'Roscini', 'year': '2016', 'raw': "Marco Roscini, 'Digital Evidence as a Means of Proof before the International Court of Justice' (2016) 21 Journal of Conflict and Security Law 541.", 'footnote_number': 170, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '171', 'context_preceding': 'A characteristic of digital evidence is that parties may be particularly reluctant to reveal the sources and procedures through which they had obtained the evidence it has submitted. While there are no sanctions for this, the litigating party bears the risk that the evidence is excluded or given reduced weight and that the facts it claims will not be considered sufficiently proved, due to the inability to establish the authenticity, accuracy and completeness of the evidence.', 'author': 'Roscini', 'year': '2017', 'raw': 'Roscini (n 127), 240.', 'footnote_number': 171, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '172', 'context_preceding': 'A characteristic of digital evidence is that parties may be particularly reluctant to reveal the sources and procedures through which they had obtained the evidence it has submitted. While there are no sanctions for this, the litigating party bears the risk that the evidence is excluded or given reduced weight and that the facts it claims will not be considered sufficiently proved, due to the inability to establish the authenticity, accuracy and completeness of the evidence.', 'author': 'Roscini', 'year': '2016', 'raw': 'Roscini (n 170).', 'footnote_number': 172, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '173', 'context_preceding': 'A characteristic of digital evidence is that parties may be particularly reluctant to reveal the sources and procedures through which they had obtained the evidence it has submitted. While there are no sanctions for this, the litigating party bears the risk that the evidence is excluded or given reduced weight and that the facts it claims will not be considered sufficiently proved, due to the inability to establish the authenticity, accuracy and completeness of the evidence.', 'author': 'Prosecutor v Salim Jamil Ayyash et al', 'year': '2015', 'raw': 'Prosecutor v Salim Jamil Ayyash et al, Special Tribunal for Lebanon, STL-11-01, Trial Chamber, Decision on the Admissibility of Documents Published on the Wikileaks Website, STL-11-01/T/TC (21 May 2015), paras 33-35.', 'footnote_number': 173, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '174', 'context_preceding': 'Collection of evidence to prove state responsibility for cyber operations may involve violation of various norms: cyber espionage may constitute a violation of state sovereignty; international human rights and specifically the right to privacy are also likely to be implicated. This renders the question on the admissibility of illegal obtained evidence highly pertinent.', 'author': 'Roscini', 'year': '2017', 'raw': 'Roscini (n 170).', 'footnote_number': 174, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '175', 'context_preceding': 'Collection of evidence to prove state responsibility for cyber operations may involve violation of various norms: cyber espionage may constitute a violation of state sovereignty; international human rights and specifically the right to privacy are also likely to be implicated. This renders the question on the admissibility of illegal obtained evidence highly pertinent.', 'author': 'Benzing', 'year': '2019', 'raw': 'Benzing (n 32), 1380-1381, MN 29.', 'footnote_number': 175, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '176', 'context_preceding': 'Collection of evidence to prove state responsibility for cyber operations may involve violation of various norms: cyber espionage may constitute a violation of state sovereignty; international human rights and specifically the right to privacy are also likely to be implicated. This renders the question on the admissibility of illegal obtained evidence highly pertinent.', 'author': 'Benzing', 'year': '2019', 'raw': 'Benzing (n 32), 1381 MN 29; Wolfrum, and Möldner (n 122), MN 60.', 'footnote_number': 176, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '177', 'context_preceding': 'collected illegally would expose the state relying on it being called to account for its own wrongful act.', 'author': 'Roscini', 'year': '2017', 'raw': 'Roscini (n 127).', 'footnote_number': 177, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '178', 'context_preceding': 'Both in the Corfu Channel case and in the Bosnia Genocide case, the respondent states refused to submit evidence on grounds of national security. In the Corfu Channel case the evidence was to be produced under a Court order. In the Bosnia Genocide case the Court refused to give a similar order upon a Bosnian request. In neither case did the Court draw any adverse conclusions from the refusals (as it is empowered to do under its Statute).', 'author': 'ICTY', 'year': '1997', 'raw': "According to the ICTY, the Court's order in the Corfu Channel case was couched in non-mandatory terms, and therefore reliance on the absence of consequences for the UK's refusal is inapposite. Prosecutor v Tihomir Blaškić, Case IT-95-14, Appeal Judgment on the Request of the Republic of Croatia for Review of the Decision of Trial Chamber II of 18 July 1997 (29 October 1997) para 62. See also Christian J Tams and James G Devaney, 'Commentary to Article 49', in Andreas Zimmermann and Christian J Tams (eds), The Statute of the International Court of Justice: A Commentary (Oxford University Press, 3rd edn 2019) 1415, 1424-25, MN 21.", 'footnote_number': 178, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '179', 'context_preceding': 'Both in the Corfu Channel case and in the Bosnia Genocide case, the respondent states refused to submit evidence on grounds of national security. In the Corfu Channel case the evidence was to be produced under a Court order. In the Bosnia Genocide case the Court refused to give a similar order upon a Bosnian request. In neither case did the Court draw any adverse conclusions from the refusals (as it is empowered to do under its Statute).', 'author': 'Benzing', 'year': '2019', 'raw': 'Benzing (n 32), 1380-81, MN 27-28.', 'footnote_number': 179, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '180', 'context_preceding': 'Both in the Corfu Channel case and in the Bosnia Genocide case, the respondent states refused to submit evidence on grounds of national security. In the Corfu Channel case the evidence was to be produced under a Court order. In the Bosnia Genocide case the Court refused to give a similar order upon a Bosnian request. In neither case did the Court draw any adverse conclusions from the refusals (as it is empowered to do under its Statute).', 'author': 'ICTY', 'year': '1997', 'raw': 'Case law cited by the ICTY in Blaškić (n 178) para 62.', 'footnote_number': 180, 'page_index': None}, {'citation_type': 'footnote', 'citation_anchor': '181', 'context_preceding': 'even to a judge. As a minimum, the state would be required to submit an affidavit by a responsible officer describing the documents and the precise grounds for the desire to withhold them. This affidavit would be considered in camera. If the judge is not satisfied that the reasons adduced by the state are valid and persuasive, the tribunal may make a judicial finding of non-compliance, which would bear the consequences under the tribunal’s rules. Similar arrangements could be adopted also in cases of invocation of national security in adjudicating responsibility for cyber operations.', 'author': 'Blaškić', 'year': '1997', 'raw': 'Blaškić (n 178), paras 65-68 and disposition.', 'footnote_number': 181, 'page_index': None}]}

# print(out["structured_references"])
# a =references_to_graph(structured_references=out,source_doc_id="a3467")
a_list=[
    # 'C:\\Users\\luano\\Zotero\\storage\\3R2MZGXM\\(Yael Ronen, 2020).pdf',

    'C:\\Users\\luano\\Zotero\\storage\\2DFBFQRI\\Mikanagi and Macak - 2020 - Attribution of cyber operations an  international law perspective on the park jin hyok case.pdf',

    'C:\\Users\\luano\\Zotero\\storage\\9EGP9PBM\\Nye - 2016 - Deterrence and dissuasion in cyberspace.pdf', 'C:\\Users\\luano\\Zotero\\storage\\Q7HZWRBA\\Schmitt - 1999 - Computer Network Attack and the Use of Force in International Law Thoughts on a Normative Framework.pdf',
    'C:\\Users\\luano\\Zotero\\storage\\RPMI77E8\\Prescott - 2011 - War by analogy US cyberspace strategy and international humanitarian law.pdf', 'C:\\Users\\luano\\Zotero\\storage\\ICAKJ5L5\\Kodar - 2009 - Computer network attacks in the grey areas of jus ad bellum and jus in bello.pdf', 'C:\\Users\\luano\\Zotero\\storage\\Y43F6E7G\\Joyner and Lotrionte - 2001 - Information warfare as international coercion elements of a legal framework.pdf', 'C:\\Users\\luano\\Zotero\\storage\\QUTGADTW\\viewcontent.cgi.pdf', 'C:\\Users\\luano\\Zotero\\storage\\VC3J6RSK\\IVE6FH53.pdf', 'C:\\Users\\luano\\Zotero\\storage\\G8S42VK6\\Baram - 2025 - When intelligence agencies publicly attribute offensive cyber operations illustrative examples from.pdf', 'C:\\Users\\luano\\Zotero\\storage\\KAPVLLSB\\Dong et al. - 2025 - Spatiotemporal characteristics and drivers of global cyber conflicts.pdf', 'C:\\Users\\luano\\Zotero\\storage\\MSTP3MJK\\TD5PT97Q.pdf',
        # 'C:\\Users\\luano\\Zotero\\storage\\99VRUZAP\\Jones - 2025 - Food security and cyber warfare vulnerabilities, implications and resilience-building.pdf', 'C:\\Users\\luano\\Zotero\\storage\\7ZCU665W\\Shandler - 5187 - Cyber conflict & domestic audience costs.pdf', 'C:\\Users\\luano\\Zotero\\storage\\4FT28KIJ\\Leal - 2025 - Blame games in cyberspace how foreign cues shape public opinion on cyber attribution and retributio.pdf', 'C:\\Users\\luano\\Zotero\\storage\\BSWYT548\\Whyte - 2025 - The subversion aversion paradox juxtaposing the tactical and strategic utility of cyber-enabled inf.pdf', 'C:\\Users\\luano\\Zotero\\storage\\BVKDVM6A\\5216954.pdf', 'C:\\Users\\luano\\Zotero\\storage\\XHEFXPZG\\book-part-9781035308514-14.pdf', 'C:\\Users\\luano\\Zotero\\storage\\3A8G854U\\24JKoreanL83.pdf',
        # 'C:\\Users\\luano\\Zotero\\storage\\TMV6IRC5\\Merriman - 2025 - Cyber warfare and state responsibility  exploring accountability in international law.pdf', 'C:\\Users\\luano\\Zotero\\storage\\A4KMJT42\\5249574.pdf', 'C:\\Users\\luano\\Zotero\\storage\\PL98EQNV\\Ying and Shi - 2025 - The chinese restrictive approach to the law on the use of force and its application in cyberspace.pdf', 'C:\\Users\\luano\\Zotero\\storage\\8PTWUENN\\IGBQNFQD.pdf', "C:\\Users\\luano\\Zotero\\storage\\UPUSZZRX\\Neilsen and Pontbriand - 5187 - hands off the keyboard NATO's cyber-defense of civilian critical infrastructure.pdf",
        # 'C:\\Users\\luano\\Zotero\\storage\\KM2FN3Q2\\Hedling and Oerden - 2025 - Disinformation, deterrence and the politics of attribution.pdf', 'C:\\Users\\luano\\Zotero\\storage\\U6CWP57T\\Smedes - 2025 - The increasing prevalence of cyber operations and the inadequacy of international law to address the.pdf', 'C:\\Users\\luano\\Zotero\\storage\\FEJ9RTEX\\Cheng and Li - 2025 - State responsibility in the context of cyberwarfare dilemma identification and path reconstruction.pdf', 'C:\\Users\\luano\\Zotero\\storage\\FS6PF4KE\\Nihreieva - 2025 - State responsibility for cyberattacks as a use of force in the context of the 2022 russian invasion.pdf']
]
li=[]
# for i in a_list:
#     outputs = ocr_single_pdf_structured(
#         pdf_path=i,
#         api_key=api_key)["structured_references"]
#     print(outputs)
#     input("aaaa")
# result = submit_mistral_ocr3_batch(
#     pdf_paths=a_list,
#     api_key=api_key,
# )
if __name__ == "__main__":

# process_pdf_markdown_with_call_models(pdf_path='C:\\Users\\luano\\Zotero\\storage\\2DFBFQRI\\Mikanagi and Macak - 2020 - Attribution of cyber operations an  international law perspective on the park jin hyok case.pdf')
    a =process_pdf(pdf_path=r'C:\Users\luano\Zotero\storage\USBCBC6G\van der Meer - 2015 - Enhancing international cyber security.pdf')
    print(a.keys())
# outputs = [
#     {
#         "references": (
#             item.get("structured_references", {}).get("references", [])
#             if isinstance(item.get("structured_references"), dict)
#             else []
#         )
#     }
#     for item in mistral_batch_references(pdf_paths=a_list).get("processed", [])
# ]

#  =references_local_global_graph(sample_structured_references_list)
# print(a)
# print(result)
