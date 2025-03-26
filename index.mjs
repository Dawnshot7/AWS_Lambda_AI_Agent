import fetch from "node-fetch";
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// Available functions mapping
const functionMap = {
  dynamicSupabaseOperation: dynamicSupabaseOperation,
  setSpecialization: setSpecialization,
  synthesizeKnowledge: synthesizeKnowledge,
  retrieveRelevantKnowledge: retrieveRelevantKnowledge
};

let currentSpecialization = 'secretary';
let specializationInstructionText = "";

// Initialize PostgreSQL client for Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Enhanced Dynamic Supabase Function Handler
async function dynamicSupabaseOperation(params) {
  try {
    // Validate required parameters
    if (!params.from || !params.action) {
      throw new Error('Missing required parameters: "from" and "action"');
    }

    // Start with the base query
    let query = supabase.from(params.from);
    let queryResult = {};

    // Map of supported actions
    const actionMap = {
      'select': () => {
        // Handle select with optional columns
        const columns = params.columns || '*';
        let selectQuery = query.select(columns);
        
        // Apply filters if provided
        if (params.filter) {
          switch(filter.operator) {
            case 'eq':
              selectQuery = selectQuery.eq(params.filter.column, params.filter.value);
              break;
            case 'neq':
              selectQuery = selectQuery.neq(params.filter.column, params.filter.value);
              break;
            case 'gt':
              selectQuery = selectQuery.gt(params.filter.column, params.filter.value);
              break;
            case 'lt':
              selectQuery = selectQuery.lt(params.filter.column, params.filter.value);
              break;
            case 'gte':
              selectQuery = selectQuery.gte(params.filter.column, params.filter.value);
              break;
            case 'lte':
              selectQuery = selectQuery.lte(params.filter.column, params.filter.value);
              break;
            case 'like':
              selectQuery = selectQuery.like(params.filter.column, `%${params.filter.value}%`);
              break;
            case 'ilike':
              selectQuery = selectQuery.ilike(params.filter.column, `%${params.filter.value}%`);
              break;
            case 'in':
              selectQuery = selectQuery.in(params.filter.column, params.filter.value);
              break;
            case 'contains':
              // For JSONB fields
              selectQuery = selectQuery.contains(params.filter.column, params.filter.value);
              break;
            case 'range':
              // For date ranges
              selectQuery = selectQuery.gte(params.filter.column, params.filter.value[0])
                                      .lte(params.filter.column, params.filter.value[1]);
              break;
            default:
              throw new Error(`Unsupported filter operator: ${params.filter.operator}`);
          }
        }
        
        // Apply ordering if provided
        if (params.order) {
          params.order.forEach(order => {
            selectQuery = selectQuery.order(order.column, { ascending: order.ascending });
          });
        }
        
        // Apply pagination if provided
        if (params.pagination) {
          if (params.pagination.limit) {
            selectQuery = selectQuery.limit(params.pagination.limit);
          }
          if (params.pagination.offset) {
            selectQuery = selectQuery.offset(params.pagination.offset);
          }
        }
        
        return selectQuery;
      },
      'insert': () => {
        // Handle single or multiple inserts
        const data = params.data;
        return query.insert(data);
      },
      'update': () => {
        // Handle update with conditions
        const updateData = params.data;
        let updateQuery = query.update(updateData);
        
        // Apply conditions
        if (params.filter) {
          switch(params.filter.operator) {
            case 'eq':
              updateQuery = updateQuery.eq(params.filter.column, params.filter.value);
              break;
            case 'neq':
              updateQuery = updateQuery.neq(params.filter.column, params.filter.value);
              break;
            case 'in':
              updateQuery = updateQuery.in(params.filter.column, params.filter.value);
              break;
            // Add other operators as needed
            default:
              throw new Error(`Unsupported filter operator: ${params.filter.operator}`);
          }
        }
        
        return updateQuery;
      },
      'delete': () => {
        // Handle delete with conditions
        let deleteQuery = query.delete();
        
        if (params.filter) {
          switch(params.filter.operator) {
            case 'eq':
              deleteQuery = deleteQuery.eq(params.filter.column, params.filter.value);
              break;
            case 'in':
              deleteQuery = deleteQuery.in(params.filter.column, params.filter.value);
              break;
            // Add other operators as needed
            default:
              throw new Error(`Unsupported filter operator: ${params.filter.operator}`);
          }
        }
        
        return deleteQuery;
      },
      'upsert': () => {
        // Handle upsert with optional conflict resolution
        const data = params.data;
        const options = params.options || {};
        return query.upsert(data, options);
      },
      'join': () => {
        // New action: handle joins between tables
        if (!params.join) {
          throw new Error('Missing join parameters for join action');
        }
        
        // Base table is specified by params.from
        // Get columns from base table
        const baseColumns = params.baseColumns || '*';
        
        // Start with selecting from base table
        let joinQuery = query.select(baseColumns);
        
        // For each join table
        params.join.forEach(joinSpec => {
          // Validate join specification
          if (!joinSpec.table || !joinSpec.on) {
            throw new Error('Join specification missing table or on clause');
          }
          
          // Create the foreign key - we need to format it as "foreign_table(foreign_column)"
          const foreignKey = `${joinSpec.table}(${joinSpec.on.foreign})`;
          
          // Add columns from the joined table (with optional alias prefixing)
          const joinedColumns = joinSpec.columns || '*';
          let formattedColumns;
          
          if (joinSpec.columnPrefix) {
            // If a prefix is specified, add it to each column name
            if (joinedColumns === '*') {
              // Can't prefix '*', so we need to specify columns
              throw new Error('Cannot use "*" with columnPrefix. Please specify columns explicitly.');
            }
            formattedColumns = joinedColumns.split(',').map(col => 
              `${col.trim()}:${joinSpec.columnPrefix}${col.trim()}`
            ).join(',');
          } else {
            formattedColumns = joinedColumns;
          }
          
          // Perform the join
          joinQuery = joinQuery.select(formattedColumns, { foreignTable: joinSpec.table });
          
          // Set up the join condition
          const joinType = joinSpec.type || 'inner'; // default to inner join
          switch(joinType.toLowerCase()) {
            case 'inner':
              joinQuery = joinQuery.eq(joinSpec.on.local, foreignKey);
              break;
            case 'left':
              joinQuery = joinQuery.or(`${joinSpec.on.local}.eq.${foreignKey},${joinSpec.on.local}.is.null`);
              break;
            default:
              throw new Error(`Unsupported join type: ${joinType}`);
          }
        });
        
        // Apply additional filters if provided
        if (params.filter) {
          switch(params.filter.operator) {
            case 'eq':
              joinQuery = joinQuery.eq(params.filter.column, params.filter.value);
              break;
            // Add other operators as needed
            default:
              throw new Error(`Unsupported filter operator: ${params.filter.operator}`);
          }
        }
        
        return joinQuery;
      },
      'search': () => {
        // New action: full-text search across fields
        if (!params.searchTerm) {
          throw new Error('Missing searchTerm parameter for search action');
        }
        
        // Columns to search in
        const searchColumns = params.searchColumns || ['title', 'description', 'content'];
        
        // Create a query with OR conditions for each column
        let firstColumn = true;
        let searchQuery;
        
        searchColumns.forEach(column => {
          if (firstColumn) {
            searchQuery = query.ilike(column, `%${params.searchTerm}%`);
            firstColumn = false;
          } else {
            searchQuery = searchQuery.or(`${column}.ilike.%${params.searchTerm}%`);
          }
        });
        
        // Select specific columns if requested
        if (params.columns && params.columns !== '*') {
          searchQuery = searchQuery.select(params.columns);
        }
        
        return searchQuery;
      }
    };

    // Check if the action is supported
    if (!actionMap[params.action]) {
      throw new Error(`Unsupported action: ${params.action}`);
    }

    // Execute the query
    const { data, error } = await actionMap[params.action]();

    // Handle potential errors
    if (error) {
      console.error('Supabase Operation Error:', error);
      return { 
        success: false, 
        error: error.message 
      };
    }

    // Return successful result
    return { 
      success: true, 
      data: data 
    };
  } catch (error) {
    console.error('Dynamic Supabase Operation Error:', error);
    return { 
      success: false, 
      error: error.message 
    };
  }
}

// New function to set specialization
async function setSpecialization(params) {
  try {
    // Validate required parameters
    if (!params.specializationName) {
      throw new Error('Missing required parameter: "name"');
    }

    // Get the requested specialization from the database
    const { data, error } = await supabase
      .from('specializations')
      .select('id, name, instruction_text')
      .eq('name', params.specializationName)
      .single();

    if (error) {
      console.error("Error fetching specialization:", error);
      return { 
        success: false, 
        error: "Failed to retrieve specialization." 
      };
    }

    if (!data) {
      return { 
        success: false, 
        error: `Specialization "${params.specializationName}" not found or inactive.` 
      };
    }

    currentSpecialization = data.name;
    specializationInstructionText = data.instruction_text
    console.log(`Switched to specialization: ${currentSpecialization}`);
    
    // Return the specialization information
    return { 
      success: true, 
      data: `Switched to specialization: ${currentSpecialization}`
    };
  } catch (error) {
    console.error('Specialization Selection Error:', error);
    return { 
      success: false, 
      error: error.message 
    };
  }
}

// Knowledge Synthesis Function
async function synthesizeKnowledge(params) {
  try {
    // Validate required parameters
    if (!params.topic || !params.content) {
      throw new Error('Missing required parameters: "topic" and "content"');
    }

    // Check if a similar knowledge snippet already exists
    const { data: existingSnippets, error: searchError } = await supabase
      .from('knowledge_snippets')
      .select('*')
      .ilike('topic', `%${params.topic}%`)
      .limit(5);

    if (searchError) {
      console.error('Error searching for existing knowledge:', searchError);
      return {
        success: false,
        error: searchError.message
      };
    }

    // Decide whether to update existing knowledge or create new
    let operation;
    let operationData;
    
    if (existingSnippets && existingSnippets.length > 0) {
      // We found similar knowledge - update the closest match
      // In a more advanced implementation, you might use semantic similarity here
      
      const mostRelevantSnippet = existingSnippets[0];
      
      operationData = {
        id: mostRelevantSnippet.id,
        last_updated: new Date().toISOString(),
        content: params.content,
        confidence: params.confidence || 0.7,
        // Merge related entities if provided
        related_entities: params.related_entities 
          ? { ...mostRelevantSnippet.related_entities, ...params.related_entities }
          : mostRelevantSnippet.related_entities
      };
      
      operation = supabase
        .from('knowledge_snippets')
        .update(operationData)
        .eq('id', mostRelevantSnippet.id);
        
    } else {
      // Create new knowledge snippet
      operationData = {
        topic: params.topic,
        content: params.content,
        source: params.source || 'user_interaction',
        confidence: params.confidence || 0.7,
        related_entities: params.related_entities || {}
      };
      
      operation = supabase
        .from('knowledge_snippets')
        .insert(operationData);
    }

    // Execute the operation
    const { data, error } = await operation;

    // Handle potential errors
    if (error) {
      console.error('Knowledge Synthesis Error:', error);
      return { 
        success: false, 
        error: error.message 
      };
    }

    // Log the interaction
    await supabase
      .from('interactions')
      .insert({
        query: params.sourceQuery || 'knowledge synthesis',
        response: 'knowledge updated',
        knowledge_updated: {
          topic: params.topic,
          operation: existingSnippets && existingSnippets.length > 0 ? 'update' : 'insert'
        }
      });

    // Return successful result
    return { 
      success: true, 
      data: {
        message: existingSnippets && existingSnippets.length > 0 
          ? 'Existing knowledge updated' 
          : 'New knowledge created',
        knowledge: operationData
      }
    };
  } catch (error) {
    console.error('Knowledge Synthesis Error:', error);
    return { 
      success: false, 
      error: error.message 
    };
  }
}

// Knowledge Retrieval Function using Supabase PostgreSQL function
async function retrieveRelevantKnowledge(params) {
  try {
    // Validate required parameters
    if (!params.query) {
      throw new Error('Missing required parameter: "query"');
    }

    // Extract keywords from the query
    const queryWords = params.query
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 3); // Filter out short words

    // If no meaningful keywords found, return empty
    if (queryWords.length === 0) {
      return {
        success: true,
        data: []
      };
    }

    // Call the PostgreSQL function via RPC
    const { data, error } = await supabase
      .rpc('search_knowledge_snippets', {
        search_terms: queryWords,
        results_limit: params.limit || 50
      });

    // Handle potential errors
    if (error) {
      console.error('Knowledge Retrieval Error:', error);
      return { 
        success: false, 
        error: error.message 
      };
    }

    // The data is already sorted and scored by the PostgreSQL function
    // No need for additional scoring or sorting

    // Return successful result
    return {
      success: true,
      data: data.map(item => ({
        topic: item.topic,
        content: item.content
      }))
    };
  } catch (error) {
    console.error('Knowledge Retrieval Error:', error);
    return { 
      success: false, 
      error: error.message 
    };
  }
}

// Base instructions prompt that explains response format to the LLM
const getInstructionsPrompt = (specialization = null) => {
  let baseInstructions = `AI AGENT SYSTEM INSTRUCTIONS
  CORE ROLE
  You are an AI assistant that helps users by performing tasks through function calls. You respond in JSON format and your responses will be used programmatically. 
  Because you are part of this AI agent, you can utilize functions that can be called by populating the "function", "parameters", and "reasoning" fields in your structured response.
  
  RESPONSE FORMAT
  Your responses must always be valid JSON with this structure:
  {
    "answer": "", // Direct answer to the user's question (if available)
    "reasoning": "", // Your thought process (required when using functions). Be verbose and use the present tense to tell your strategy to the next LLM, including what functions you are calling and why. Do not make any present tense statements about the state of the database that might confuse future LLMs reading the conversation history. Those LLMs need to read the function results for the state of the database.
    "function_calls": [{"function":"","parameters":""}] // List of functions to call (empty if providing direct answer)
  }
  
  FUNCTION USE INSTRUCTIONS
  - You may need to utilize a data retrieval function to answer a question about information in a database if that information is needed to answer the question.
  - This means you can't provide an answer to the user directly in this chat completion, and another request to an LLM will be made which will include the information that the function retrieves from the database using the parameters you gave it.
  - This is a multi-step process coordinated programatically by the AI agent, and you may be receiving the intial user query, or you may receive the results data from function calls along with the conversation history and reasoning.
  - Whether you are receiving the initial user query or function results and a conversation history will be revealed further below in this system prompt once you get to the conversation history section.
  - Only use a function if explicitly needed for tasks.
  - For questions that need no functions to answer, just provide the answer directly.
  - For questions that need multiple simultaneous function calls to answer, respond with a list of functions to call and their parameters. 
  - There can be multiple rounds of multiple simultaneous function calls, and the agent will iteratively provide the information from all previous function calls to new, follow-up LLM chat completions, and those LLM chat completions can request further function calls until an answer to the user query can be generated. 
  - Do not prompt the user for further information or permission to use functions. 
  - Assume that you are to infer what functions are needed, use them in batches preferably, or in sequence if needed, and provide an answer to the best of your ability when you have gathered the information needed.
  - If it looks like the user's request cannot be completed, first try retrieving knowledge snippets using the knowledge retrieval tool.

  WORKFLOW PRINCIPLES
  - First assess what information you need to answer the user's question
  - Use functions to retrieve or modify data when necessary
  - Always verify database changes with a follow-up 'select' database operation
  - Choose the appropriate specialization for the next step
  
  AVAILABLE FUNCTIONS
  1. dynamicSupabaseOperation
  Description:
  - This function retrieves or modifies data in a database.
  
  Available Database Tables
  - todo_list - User's current to-do items (id, created_at, description)
  - shopping_list - User's shopping items (id, created_at, description)
  
  Parameters:
  - from (Required): (String) Table name (todo_list or shopping_list)
  - action (Required): (String) Operation type (select, insert, update, delete, upsert)
  - columns (Optional): (String) Comma-separated string of column names for select
  - data (Optional): (Object) Data object for insert/update/upsert
  - filter (Optional): (Object) Filter condition. 
  
  Filter Structure:
  {
    "column": "column_name",
    "operator": "eq|neq|gt|lt|in|gte|lte",
    "value": "column_value"
  }  
  
  2. setSpecialization
  Description:
  - This function determines which specialization should handle the next step of the process. 
  - It is important that you call this function with the specialization name as the parameter when you are ready to move on to the next step.
  - Every set of function calls should also include a call to this function. This, however doesn't apply if you have a final answer and are filling the 'answer' parameter. 
  - Setting the specialization will extend the instructions text for the next LLM chat completion with specific instructions for it's role in the process of answering the user query. 
  - Example: Assigning the 'secretary' specialization will provide the next LLM a thorough background on the user's recent history of modifications to their lists, the user's goals and current projects, the user's preferences of how they like their agent to communicate (sense of humor, offering suggestions, etc.), as well as the user's recent history of location data, and functions for scheduling reminders and writing emails. 
  - This additional specialization data and associated instructions will be added to the next LLM's instructions, and will increase the prompt size.
  - The specializations have been created so that only chat completions that need extra information receive it in their prompt. 
  
  Available Specializations:
   - secretary - manages user's recent history of modifications to their lists, the user's goals and current projects, the user's preferences of how they like their agent to communicate (sense of humor, offering suggestions, etc.), as well as the user's recent history of location data, and functions for scheduling reminders and writing emails. 

  Parameters:
  - specializationName (Required): (String) Specialization name ('secretary|codeAssistant|projectManager')
  
  3. retrieveRelevantKnowledge
  Description:
  - Knowledge retrieval tool. 
  - Before providing the final answer to a user query, gather relevant context by using the retrieveRelevantKnowledge function with a search query as the parameter. 
  - This performs a vector search for knowledge snippets using any 4 or more letter words in your query.
  - Matches in the topic field are weighted more heavily (3x) than matches in content. 
  - Results are adjusted by the confidence score
  - Results are sorted by relevance score  
  - Review the list of knowledge topics that will be included below the system prompt instructions, and before the conversation history. This contains the exact topics of all of the available knowledge, so you know what keywords to use to search. You can add additional keywords not in this list so you can find references in the 'content' of each of the knowledge snippets as well, not just the 'topic' fields.
  - Example: If the user asks you to add apples to his shopping list, calling this function may reveal that the user only likes opal apples, and you should add opal apples to their shopping list.
  - The user keeps his knowledge snippets database updated with preferences for how you should answer questions or perform activities related to specific topics or items.   
  - Tips for effective searching:
    * Use specific keywords rather than phrases. 
    * Use multiple keywords in each search to ensure you don't miss any knowledge that doesn't exactly match your keyword (such as for "School", also search "College University School Education"]). It is better to use more search terms than less.
    * Try synonyms 
    * Capitalize the first letter of each keyword (e.g., "Project" not "project")
     
  Parameters:
  - query (Required): Search query
  - limit (Optional): Maximum results (default: 50)
  
  4. synthesizeKnowledge
  Description:
  - Knowledge synthesis tool. 
  - After completing tasks or learning new information about the user, synthesize this knowledge by using the synthesizeKnowledge function to store it for future reference. 
  - Especially use this function if the user asks you to remember something. 
  - This knowledge's topic and content will be searchable by future LLMs using retrieveRelevantKnowledge. 
  - This function either updates existing knowledge or creates new knowledge snippets based on the exact text of your 'topic' field.
  
  Parameters:
  - topic (Required): (String) The main subject of the knowledge. Use searchable keywords.
  - content (Required): (String) The actual knowledge content. This can be any amount of text. If the user asks for code, make sure it stays within the string without any escape character issues.
  - source (Optional): (String) Where the knowledge came from (defaults to 'user_interaction'). Alternatively you can be asked by a 'proectManager' specialization to add knowledge to the snippets with source = 'research_data" if you are storing webscraped information for example.
  - confidence (Optional): (Number) Confidence score from 0-1 (defaults to 0.7. Round to this many digits). 
  - sourceQuery (Optional): (String) The original query that led to this knowledge update (found in the conversation history section at the end of this system prompt)
  
IMPORTANT FUNCTION CALLING AND WORKFLOW RULES
  - When modifying items by description: First select the full list to find the item ID matching the description. Assume the user query is spelled wrong, and don't apply filters for exact text.
  - Before adding items: Check if they already exist using select
  - After any modification: Always verify with a select operation. The operation may have been completed twice or not at all, despite the function returning a status of 'success'. 
  - Don't apply filters when using select after delete operations in case the item was spelled wrong in the user query. 
  - Notice and reverse any errors you make from duplicating actions with appropriate follow-up function calls. 
  - Function order: Call setSpecialization last (except when providing a final answer)
  - When you have the answer: Fill the "answer" field and leave function_calls empty
  - Do not call setSpecialization if you have the answer ready to give to the user, just populate the 'answer' parameter and leave the functions list empty.
  - Use the retrieveRelevantKnowledge() function immediately using a search query that will find any relevant saved information related to the user query.
  - Do not repeat any steps if an LLM has previously already completed them, and respond to the user with an answer once you have one ready.

  Workflow Example
  - User query: "Add apples to my shopping list"
  - Step 1: Initial assessment, retrieving knowledge snippets, and setting specialization
  {
    "answer": "",
    "reasoning": "Need to check if apples are already on the list and retrieve any relevant user knowledge",
    "function_calls": [
      {
        "function": "dynamicSupabaseOperation",
        "parameters": {
          "from": "shopping_list",
          "action": "select",
          "columns": "id, description"
        }
      },
      {
        "function": "retrieveRelevantKnowledge",
        "parameters": {
          "query": "Apples Shopping List"
        }
      },
      {
        "function": "setSpecialization",
        "parameters": {
          "specializationName": "secretary"
        }
      }
    ]
  }
  - Step 2: Add Item to database (If Not Already Present) and setting specialization
  {
    "answer": "",
    "reasoning": "Apples not found on list, adding the item and verifying",
    "function_calls": [
      {
        "function": "dynamicSupabaseOperation",
        "parameters": {
          "from": "shopping_list",
          "action": "insert",
          "data": {
            "description": "Apples"
          }
        }
      },
      {
        "function": "dynamicSupabaseOperation",
        "parameters": {
          "from": "shopping_list",
          "action": "select",
          "columns": "id, description"
        }
      },
      {
        "function": "setSpecialization",
        "parameters": {
          "specializationName": "secretary"
        }
      }
    ]
  }
  - Step 3: Final Response
  {
    "answer": "I've added apples to your shopping list.",
    "reasoning": "",
    "function_calls": []
  }
`;
  
  // If we have a specialization, include its instructions
  //if (specialization) {
  //  baseInstructions = `${baseInstructions}\n\n--- You have been assigned as SPECIALIZATION: ${currentSpecialization} 
  //  ---\nThe following are instructions specific for your specialization:\n\n SPECIALIZATION INSTRUCTIONS: ${specializationInstructionText}`;
  //}

   return baseInstructions;
}

async function makeAIRequest(messages) {
  const MAX_RETRIES = 5;
  let retryCount = 0;
  let lastError = null;

  while (retryCount < MAX_RETRIES) {
    perfMetrics.start('makeAIRequest');

    try {
      console.log(`Attempt ${retryCount + 1}/${MAX_RETRIES} to make LLM request`);
      
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
          "HTTP-Referer": "https://yourwebsite.com",
          "X-Title": "Your Website Name",
        },
        body: JSON.stringify({
          model: "google/gemini-2.0-flash-lite-preview-02-05:free",
          messages: messages,
          temperature: 0.2,
        }),
      });
      // "deepseek/deepseek-r1:free"
      // "deepseek/deepseek-r1-distill-llama-70b:free"
      // "google/gemini-2.0-flash-lite-preview-02-05:free"
      const data = await response.json();
      
      // Extract the message content
      const rawReply = data.choices?.[0]?.message?.content || "No response";
      
      // Check if we got a valid response
      if (rawReply.trim() === "No response" || !rawReply) {
        console.log(`Attempt ${retryCount + 1} failed: Empty response received`);
        retryCount++;
        
        // Add exponential backoff delay
        const delay = Math.min(1000 * 2 ** retryCount, 10000); // Max 10 second delay
        console.log(`Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      // Parse the JSON response
      try {
        // Check if the response is wrapped in a code block
        let jsonContent = rawReply;
  
        // Check for markdown code blocks (```json ... ```) and remove any preamble text
        if (rawReply.includes("```")) {
          // Extract content between the code block markers
          const codeBlockMatch = rawReply.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (codeBlockMatch && codeBlockMatch[1]) {
            jsonContent = codeBlockMatch[1].trim();
          }
        }

        // Remove any text before the first opening brace and after the last closing brace
        const firstBraceIndex = jsonContent.indexOf('{');
        const lastBraceIndex = jsonContent.lastIndexOf('}');
        
        if (firstBraceIndex >= 0 && lastBraceIndex > firstBraceIndex) {
          jsonContent = jsonContent.substring(firstBraceIndex, lastBraceIndex + 1);
        }

        // Parse the cleaned JSON content
        const parsedReply = JSON.parse(jsonContent);
        perfMetrics.end('makeAIRequest');

        return parsedReply;
      } catch (e) {
        console.error("Failed to parse response as JSON:", e);
        console.log("Raw response:", rawReply);
        
        // If this was a parsing error, increment retry count
        retryCount++;
        lastError = e;
        
        // Add exponential backoff delay
        const delay = Math.min(1000 * 2 ** retryCount, 10000);
        console.log(`Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        perfMetrics.end('makeAIRequest');
        continue;
      }
    } catch (error) {
      console.error(`Attempt ${retryCount + 1} failed with error:`, error);
      retryCount++;
      lastError = error;
      
      // If we've reached max retries, break out of the loop
      if (retryCount >= MAX_RETRIES) {
        break;
      }
      
      // Add exponential backoff delay
      const delay = Math.min(1000 * 2 ** retryCount, 10000);
      console.log(`Waiting ${delay}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      perfMetrics.end('makeAIRequest');
    }
  }
  perfMetrics.end('makeAIRequest');
  console.error(`Failed after ${MAX_RETRIES} attempts`);
  return { 
    answer: `Error: Failed to communicate with AI service after ${MAX_RETRIES} attempts. Last error: ${lastError?.message || "Unknown error"}`, 
    function: "", 
    parameters: {} 
  };
}

async function executeFunctions(functionCalls) {
  console.log(`Executing ${functionCalls.length} functions sequentially`);

  // Array to store results
  const results = [];

  // Execute functions one after another
  for (const functionCall of functionCalls) {
    const { function: functionName, parameters } = functionCall;
    perfMetrics.start(`function:${functionName}`);

    console.log(`Executing function: ${functionName}`);
    console.log(`Parameters:`, parameters);
    
    if (!functionMap[functionName]) {
        const result = { 
            functionName: functionName,
            error: `Function ${functionName} not found` 
        };
        results.push(result);
        continue;
    }
    
    try {
        const result = await functionMap[functionName](parameters);
        const functionResult = {
            functionName: functionName,
            parameters: parameters,
            success: result.success !== false,
            data: result.data || result,
            error: result.error || null
        };
        results.push(functionResult);
       
        console.log(`Function ${functionName} completed successfully`);
    } catch (error) {
        console.error(`Error executing function ${functionName}:`, error);
        const errorResult = { 
            functionName: functionName,
            success: false,
            error: `Failed to execute function ${functionName}: ${error.message}`
        };
        results.push(errorResult);
    }
    perfMetrics.end(`function:${functionName}`);
  }

  // Combine all results into a single string
  let readableResults = "";
  results.forEach((result, index) => {
    const functionName = result.functionName;
    const paramString = JSON.stringify(result.parameters);
    
    readableResults += `Function Call ${index + 1}: ${functionName}(${paramString})\n`;
    
    if (result.success) {
      readableResults += `Status: Success\n`;
      if (result.data) {
        if (typeof result.data === 'object') {
          // Format database results nicely if they exist
          if (result.data.data && Array.isArray(result.data.data)) {
            readableResults += `Retrieved ${result.data.data.length} records:\n`;
            result.data.data.forEach((item, i) => {
              readableResults += `  Record ${i+1}: ${JSON.stringify(item)}\n`;
            });
          } else {
            readableResults += `Data: ${JSON.stringify(result.data)}\n`;
          }
        } else {
          readableResults += `Data: ${result.data}\n`;
        }
      }
    } else {
      readableResults += `Status: Failed\n`;
      readableResults += `Error: ${result.error}\n`;
    }
    
    readableResults += "\n";
  });

  return readableResults;
}

async function runAIAgent(userPrompt) {
  perfMetrics.reset(); // Reset metrics at start

  // Initialize conversation history
  let conversationHistory = [`\nCONVERSATION HISTORY ROLE: USER\n\nUser query:\n${userPrompt}\n`];
  
  // Maximum number of iterations to prevent infinite loops
  const MAX_ITERATIONS = 5;
  let iterations = 0;
  let functionsResult = null;   

  // Fetch unique topic values from knowledge_snippets table
  const { data, error } = await supabase
  .from('knowledge_snippets')
  .select('topic')
  .order('topic');

  if (error) {
  console.error('Error fetching knowledge snippets:', error);
  throw error;
  }

  // Extract unique topics
  const knowledgeList = [...new Set(data.map(item => item.topic))];
  const knowledgeTopics = `\n\n--- Knowledge Topics available for the retrieveRelevantKnowledge tool:\n${JSON.stringify(knowledgeList, null, 2)}`;

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    console.log(`\n--- Iteration ${iterations} ---`);
    
    // Build the current context for the AI
    let currentfunctionsResult = "";
    if (iterations > 1 && functionsResult) {
      currentfunctionsResult = `\n\nFUNCTION RESULTS:\n${JSON.stringify(functionsResult, null, 2)}`;
    }
    
    // Format the conversation history as a string for the system prompt
    let historyText = "\n\nCONVERSATION HISTORY INCLUDING FUNCTION RESULTS:";
    historyText += `\nRead the following like a movie script of the events that have happened 
    so far since the beginning of our conversation with the user. As each conversation role
    changes, that is the next event that has happened in sequence.\n`;

    for (const message of conversationHistory) {
      historyText += `${message}`;
    }
    
    // Combine everything into the full agent prompt
    const fullAgentPrompt = getInstructionsPrompt(currentSpecialization) + knowledgeTopics + historyText; // + currentfunctionsResult;
    console.log(`Full Prompt: ${fullAgentPrompt}`);

    // Prepare messages for the AI request
    const messages = [
      { role: "system", content: fullAgentPrompt },
    ];
    
    // Make the request to the AI
    const aiResponse = await makeAIRequest(messages);
    
    // Check if we need to call a function
    if (aiResponse.function_calls && aiResponse.function_calls.length > 0) {
      if (!currentSpecialization) {
        currentSpecialization = "router";
      }
      conversationHistory.push(`\nCONVERSATION HISTORY ROLE: LLM - ${currentSpecialization}\n`);

      // Execute the requested function
      functionsResult = await executeFunctions(aiResponse.function_calls);
      console.log(`Results:`, functionsResult);

      // Add the function call and result to the conversation history, removing backslashes
      // conversationHistory.push(`\nCONVERSATION HISTORY ROLE: LLM\n\nCalling function list:\n${JSON.stringify(aiResponse.function_calls)}. \n\nReasoning: ${aiResponse.reasoning}\n`);
      conversationHistory.push(`\nReasoning: ${aiResponse.reasoning}\n\n${functionsResult}\n`);

      // conversationHistory.push(`\nCONVERSATION HISTORY ROLE: FUNCTION\n\nFunction results:\n${functionsResult}\n`);
      
      // Continue the loop with the function result
      continue;
    } else {
      // No function call, we have the final answer
      
      // Add the final response to conversation history
      conversationHistory.push(`\nCONVERSATION HISTORY ROLE: LLM - ${currentSpecialization}\n\nResponse to user:\n${aiResponse.answer}\n`);
      
      perfMetrics.logMetrics();

      // Return the final result
      return {
        answer: aiResponse.answer,
        conversationHistory: conversationHistory,
        metrics: perfMetrics.getMetrics(), 
        specialization: currentSpecialization ? currentSpecialization : 'none'
      };
    }
  }
  
  // If we've reached the maximum number of iterations without a final answer
  perfMetrics.logMetrics();
  console.log(`\nReached maximum iterations (${MAX_ITERATIONS}) without a final answer.`);  
  return {
    answer: "I couldn't complete your request after 5 agent itterations.",
    conversationHistory: conversationHistory,
    metrics: perfMetrics.getMetrics(), 
    specialization: currentSpecialization ? currentSpecialization : 'none'
  };
}

// The Lambda handler function
export const handler = async (event) => {
  try {
    console.log('Received event:', JSON.stringify(event, null, 2));
    
    // Parse the user query from the event
    let userQuery;
    let userId;
    
    // Check if the event is from API Gateway
    if (event.body) {
      // Check for content type to determine how to parse the body
      const contentType = event.headers && (event.headers['Content-Type'] || event.headers['content-type']);
      
      if (contentType && contentType.includes('application/x-www-form-urlencoded')) {
        // Handle form-encoded data
        const formData = parseFormData(event.body);
        userQuery = formData.query;
        userId = formData.userId;
      } else {
        // Handle JSON data (default)
        const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
        userQuery = body.query;
        userId = body.userId;
      }
    } else if (event.queryStringParameters && event.queryStringParameters.query) {
      // Handle query string parameter
      userQuery = event.queryStringParameters.query;
    } else {
      // Fallback or direct invocation
      userQuery = event.query || "No query provided";
    }
    

    // Run the AI agent with the user's query
    const result = await runAIAgent(userQuery);
    
    // Return a properly formatted response for API Gateway
    if (userId === 'phone') {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*', // For CORS support
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'OPTIONS,POST,GET'
        },
        body: result.answer 
      };
    }
    else {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*', // For CORS support
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'OPTIONS,POST,GET'
        },
        body: JSON.stringify({
          message: result.answer,
          conversationHistory: result.conversationHistory,
          metrics: result.metrics,
          specialization: result.specialization
        })
      };
    }
  } catch (error) {
    console.error('Error processing request:', error);
    
    // Return error response
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'OPTIONS,POST,GET'
      },
      body: JSON.stringify({
        message: 'Error processing your request',
        error: error.message
      })
    };
  }
};

// Helper function to parse form-encoded data
function parseFormData(formBody) {
  const result = {};
  const pairs = formBody.split('&');
  
  pairs.forEach(pair => {
    const [key, value] = pair.split('=');
    if (key && value) {
      result[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, ' '));
    }
  });
  
  return result;
}

// Performance tracking utility
const perfMetrics = {
  startTimes: {},
  durations: {},
  
  start(label) {
    this.startTimes[label] = Date.now();
  },
  
  end(label) {
    if (!this.startTimes[label]) {
      console.warn(`No start time recorded for: ${label}`);
      return;
    }
    
    const duration = Date.now() - this.startTimes[label];
    this.durations[label] = (this.durations[label] || 0) + duration;
    return duration;
  },
  
  reset() {
    this.startTimes = {};
    this.durations = {};
  },
  
  getMetrics() {
    return {
      ...this.durations,
      total: Object.values(this.durations).reduce((a, b) => a + b, 0)
    };
  },
  
  logMetrics() {
    console.log("Performance Metrics (ms):");
    const metrics = this.getMetrics();
    Object.entries(metrics).forEach(([key, value]) => {
      console.log(`- ${key}: ${value}ms`);
    });
  }
};

