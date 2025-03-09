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

let currentSpecialization = null;
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
        if (params.filters) {
          params.filters.forEach(filter => {
            switch(filter.operator) {
              case 'eq':
                selectQuery = selectQuery.eq(filter.column, filter.value);
                break;
              case 'neq':
                selectQuery = selectQuery.neq(filter.column, filter.value);
                break;
              case 'gt':
                selectQuery = selectQuery.gt(filter.column, filter.value);
                break;
              case 'lt':
                selectQuery = selectQuery.lt(filter.column, filter.value);
                break;
              case 'gte':
                selectQuery = selectQuery.gte(filter.column, filter.value);
                break;
              case 'lte':
                selectQuery = selectQuery.lte(filter.column, filter.value);
                break;
              case 'like':
                selectQuery = selectQuery.like(filter.column, `%${filter.value}%`);
                break;
              case 'ilike':
                selectQuery = selectQuery.ilike(filter.column, `%${filter.value}%`);
                break;
              case 'in':
                selectQuery = selectQuery.in(filter.column, filter.value);
                break;
              case 'contains':
                // For JSONB fields
                selectQuery = selectQuery.contains(filter.column, filter.value);
                break;
              case 'range':
                // For date ranges
                selectQuery = selectQuery.gte(filter.column, filter.value[0])
                                        .lte(filter.column, filter.value[1]);
                break;
              default:
                throw new Error(`Unsupported filter operator: ${filter.operator}`);
            }
          });
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
        if (params.filters) {
          params.filters.forEach(filter => {
            switch(filter.operator) {
              case 'eq':
                updateQuery = updateQuery.eq(filter.column, filter.value);
                break;
              case 'neq':
                updateQuery = updateQuery.neq(filter.column, filter.value);
                break;
              case 'in':
                updateQuery = updateQuery.in(filter.column, filter.value);
                break;
              // Add other operators as needed
              default:
                throw new Error(`Unsupported filter operator: ${filter.operator}`);
            }
          });
        }
        
        return updateQuery;
      },
      'delete': () => {
        // Handle delete with conditions
        let deleteQuery = query.delete();
        
        if (params.filters) {
          params.filters.forEach(filter => {
            switch(filter.operator) {
              case 'eq':
                deleteQuery = deleteQuery.eq(filter.column, filter.value);
                break;
              case 'in':
                deleteQuery = deleteQuery.in(filter.column, filter.value);
                break;
              // Add other operators as needed
              default:
                throw new Error(`Unsupported filter operator: ${filter.operator}`);
            }
          });
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
        if (params.filters) {
          params.filters.forEach(filter => {
            switch(filter.operator) {
              case 'eq':
                joinQuery = joinQuery.eq(filter.column, filter.value);
                break;
              // Add other operators as needed
              default:
                throw new Error(`Unsupported filter operator: ${filter.operator}`);
            }
          });
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

// Knowledge Retrieval Function
async function retrieveRelevantKnowledge(params) {
  try {
    // Validate required parameters
    if (!params.query) {
      throw new Error('Missing required parameter: "query"');
    }

    // Extract keywords from the query
    // This is a simple approach - in production you might use NLP or embeddings
    const queryWords = params.query.toLowerCase()
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

    // Build a query to find relevant knowledge
    let knowledgeQuery = supabase
      .from('knowledge_snippets')
      .select('*');

    // Search for each keyword with OR condition
    queryWords.forEach((word, index) => {
      if (index === 0) {
        knowledgeQuery = knowledgeQuery.ilike('topic', `%${word}%`);
      } else {
        knowledgeQuery = knowledgeQuery.or(`topic.ilike.%${word}%,content.ilike.%${word}%`);
      }
    });

    // Execute the query
    const { data, error } = await knowledgeQuery;

    // Handle potential errors
    if (error) {
      console.error('Knowledge Retrieval Error:', error);
      return { 
        success: false, 
        error: error.message 
      };
    }

    // Sort by relevance (we'll use a simple heuristic here)
    const scoredResults = data.map(snippet => {
      let score = 0;
      
      // Score based on keyword matches in topic
      queryWords.forEach(word => {
        if (snippet.topic.toLowerCase().includes(word)) {
          score += 3; // Higher weight for topic matches
        }
        if (snippet.content.toLowerCase().includes(word)) {
          score += 1; // Lower weight for content matches
        }
      });
      
      // Adjust score by confidence
      score *= snippet.confidence;
      
      return {
        ...snippet,
        relevance_score: score
      };
    });

    // Sort by score and limit results
    const sortedResults = scoredResults
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .slice(0, params.limit || 5);

    // Log the retrieval in interactions
    await supabase
      .from('interactions')
      .insert({
        query: params.query,
        response: 'knowledge retrieved',
        context_retrieved: {
          snippets_count: sortedResults.length,
          top_topic: sortedResults.length > 0 ? sortedResults[0].topic : null
        }
      });

    // Return successful result
    return { 
      success: true, 
      data: sortedResults
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
  let baseInstructions = `- You are an essential member of an AI agent workflow
  that performs tasks to help answer a user query, and responds in JSON format.
- Your responses must be valid JSON without any code block wrappers.
- Your responses will be used programatically by an AI agent, so the format of the 
   response is important.
- Because you are part of this AI agent, you can utilize functions that can be called 
   by populating the "function", "parameters", and "reasoning" fields in your structured response.
- You may need to utilize a data retrieval function to answer a question about information
   in a database if that information is needed to answer the question.
- This means you can't provide an answer to the user directly in this chat completion, and
   another request to an LLM will be made which will include the information that 
   the function retrieves from the database using the parameters you gave it.
- This is a multi-step process coordinated programatically by the AI agent, and you may
   be receiving the intial user query, or you may receive the results data from 
   function calls along with the conversation history and reasoning.
- Whether you are receiving the initial user query or function results and a 
   conversation history will be revealed further below in this system prompt
   in the section for specializations.

The JSON of your response should have the following structure:
{
  "answer": "The direct answer to the user's question", // Leave empty if a function is being used
  "reasoning": "", // Overall strategy and rationale for each function use. Leave empty if no function is being used
  "function_calls": [ // Functions list to be performed sequentially. Leave empty if no function is being used
    {
      "function": "", // Name of function 1 to be called. 
      "parameters": {}, // Each function may require different parameters. 
    }
    {
      "function": "", // Name of function 2 to be called. 
      "parameters": {}, // Each function may require different parameters. 
    }
  ],
}

- Only use a function if explicitly needed for tasks.
- For questions that need no functions to answer, just provide the answer directly.
- For questions that need multiple simultaneous function calls to answer, respond with a list of 
   functions to call and their parameters. There can be multiple rounds of multiple simultaneous 
   function calls, and the agent will iteratively provide the information from all previous 
   function calls to new, follow-up LLM chat completions, and those LLM chat completions 
   can request further function calls until an answer to the user query can be generated. 
- Do not prompt the user for further information or permission to use functions. 
- Assume that you are to infer what functions are needed, use them in batches preferably, 
   or in sequence if needed, and provide an answer to the best of your ability when you have 
   gathered the information needed.

Current functions:
Function 1)
Function name: dynamicSupabaseOperation
Function parameters: from, action, columns, data, conditions, options
Function description: 
   This function provides a flexible way to interact with the Supabase databases.
   
   Available Tables:
   Table 1) The user's current to-do list
   - Table name: "todo_list"
   - Columns: "id", "created_at", "description", "status"

   Table 2) The user's current shopping list
   - Table name: "shopping_list"
   - Columns: "id", "created_at", "description", "status"

   Available Actions:
   - "select": Retrieve data from the database
   - "insert": Add new data to the database
   - "update": Modify existing data in the database
   - "delete": Remove data from the database
   - "upsert": Insert or update data in the database

Function usage:
   Detailed Usage Guide:
   - You can perform SELECT, INSERT, UPDATE, DELETE, and UPSERT operations
   - Provides a structured way to query and modify database tables
   - Supports complex conditions and filtering
   
   Function Call Structure:
   {
     "answer":""
     "reasoning": "Explain the purpose of the database operation"
     "function_calls": [
       {
        "function": "dynamicSupabaseOperation",
        "parameters": {
          "from": "table_name", // Required: specifies the target table
          "action": "select|insert|update|delete|upsert", // Required: type of operation
          "columns": "column1, column2", // Optional string for select with comma separated column names
          "data": {}, // Data required for insert/update/upsert
          "filters": [{"column": "column_name", "operator": "operator_type","value": "column_value"}], // Optional filtering conditions, all filters are applied simultaneously and all conditions must be met 
        },
      }
    ]
   }
   
   Operator Types:
   - "eq": Equal to
   - "neq": Not equal to
   - "gt": Greater than
   - "lt": Less than
   - "in": Matches any value in a list
   - "gte" 
   - "lte" 
   - "like" 
   - "ilike" 
   - "contains" 
   - "range" 

   Example Operations:
   Example 1. User query requires agent to retrieve active to-do and shopping items:
   {
     "answer":""
     "reasoning": "Calling function dynamicSupabaseOperation with the action 'select' twice, 
         once to collect the to-do list items, and once to collect the shopping list items, because
         both will be needed to answer the user query"
     "function_calls": [
       {
         "function": "dynamicSupabaseOperation",
         "parameters": {
           "from": "todo_list",
           "action": "select",
           "filters": [{"column": "status", "operator": "eq", "value": "active"}],
           "columns": "id, description"
         }
       },
       {
        "function": "dynamicSupabaseOperation",
        "parameters": {
          "from": "shopping_list",
          "action": "select",
          "filters": [{"column": "status", "operator": "eq", "value": "active"}],
          "columns": "id, description"
        }
       }
     ],
   }
   
   Example 2. Update task status given the id of the list item:
   {
     "answer":""
     "reasoning": "The user provided the id of the item on his to-do list to be marked as completed so
        I will call function dynamicSupabaseOperation with the action 'update' using this ID. I then call
        the same function with action 'select' to verify that the list item has been updated."
     "function_calls": [{
         "function": "dynamicSupabaseOperation",
         "parameters": {
           "from": "todo_list",
           "action": "update",
           "filters": [{"column": "id", "operator": "eq", "value": 1}],
           "data": {"status": "completed"}
         }  
       },
       {
        "function": "dynamicSupabaseOperation",
        "parameters": {
          "from": "todo_list",
          "action": "select",
          "columns": "id, status"
        }
      },
     ],
   }
 
Function 2)
Function name: setSpecialization
  Function parameters: specializationName
  Function description:
    This function determines which specialization should handle the next step of the process.
    Every set of function calls should also include a call to this function, or the 
    specialization will be set to 'router' for the next step in this agentic chain. This,
    however doesn't apply if you have a final answer and are filling the 'answer' parameter.
    Setting the specialization will extend the instructions text for the next LLM chat
    completion with specific instructions for it's role in the process of answering the user
    query. For instance, assigning the 'secretary' specialization will provide the next
    LLM a thorough background on the user's recent history of modifications to their lists,
    the user's goals and current projects, the user's preferences of how they like their agent to
    communicate (sense of humor, offering suggestions, etc.), as well as the user's recent
    history of location data, and functions for scheduling reminders and writing emails. This
    additional instruction text will be added to the next LLM's instructions, and will increase
    the prompt size, so the specializations have been divided up so that only chat completions
    that need extra information and functions receive it in their prompt. 
    
    Available Specializations:
    - "router" - Initial request router (default)
    - "secretary" - Manages to-do and shopping lists
    - "codeAssistant" - Helps with code and development tasks
    - "projectManager" - Coordinates complex multi-step tasks
    
  Function usage:
    {
      "answer":"",
      "reasoning": "Include in your overall reasoning an explanation why this specialization is most appropriate",
      "function_calls": [{
        "function": "setSpecialization",
        "parameters": {
          "specializationName": "specialization_name" // Required: name of the specialization
        }
      }]
    }

Additional instructions for all functions:
    - If the user requests to delete or modify a list item based on it's 'description' you must
      first select the full list and read all of the descriptions to find the matching
      item. This means you cannot complete the deletion or modification in this chat completion,
      and must first use the 'select' action. 
    - Do not add items to a list if they are already on the list. Check first using 'select'.
    - Always call the function dynamicSupabaseOperation with the action 'select' at the end of a list 
      of database modification function_calls to retrieve the table after any modifications have been made, in order to verify success. 
    - Always call setSpecialization last in every set of function_calls except when the 'answer' parameter is populated.
    - Do not call setSpecialization if you have the answer ready to give to the user, just populate the 
      'answer' parameter and leave the functions list empty.
 
Remember: Your whole response must be valid JSON without any code tags
`;
  
  // If we have a specialization, include its instructions
  if (specialization) {
    baseInstructions = `${baseInstructions}\n\n--- You have been assigned as SPECIALIZATION: ${currentSpecialization} 
    ---\nThe following are instructions specific for your specialization:\n\n SPECIALIZATION INSTRUCTIONS: ${specializationInstructionText}`;
  }

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
          model: "deepseek/deepseek-r1-distill-llama-70b:free",
          messages: messages,
          temperature: 0.2,
        }),
      });

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
    const fullAgentPrompt = getInstructionsPrompt(currentSpecialization) + historyText; // + currentfunctionsResult;
    console.log(`Full Prompt: ${fullAgentPrompt}`);

    // Prepare messages for the AI request
    const messages = [
      { role: "system", content: fullAgentPrompt },
    ];
    
    // Make the request to the AI
    const aiResponse = await makeAIRequest(messages);
    
    // Check if we need to call a function
    if (aiResponse.function_calls && aiResponse.function_calls.length > 0) {
      // Execute the requested function
      functionsResult = await executeFunctions(aiResponse.function_calls);
      console.log(`Results:`, functionsResult);

      // Add the function call and result to the conversation history, removing backslashes
      // conversationHistory.push(`\nCONVERSATION HISTORY ROLE: LLM\n\nCalling function list:\n${JSON.stringify(aiResponse.function_calls)}. \n\nReasoning: ${aiResponse.reasoning}\n`);
      conversationHistory.push(`\nCONVERSATION HISTORY ROLE: LLM - ${currentSpecialization}\n\nReasoning: ${aiResponse.reasoning}\n\n${functionsResult}\n`);

      // conversationHistory.push(`\nCONVERSATION HISTORY ROLE: FUNCTION\n\nFunction results:\n${functionsResult}\n`);
      
      // Continue the loop with the function result
      continue;
    } else {
      // No function call, we have the final answer
      
      // Add the final response to conversation history
      conversationHistory.push(`\nCONVERSATION HISTORY ROLE: LLM\n\nResponse to user:\n${aiResponse.answer}\n`);
      
      perfMetrics.logMetrics();

      // Return the final result
      return {
        answer: aiResponse.answer,
        conversationHistory: conversationHistory,
        metrics: perfMetrics.getMetrics(), 
        specialization: currentSpecialization ? currentSpecialization.name : 'none'
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
    specialization: currentSpecialization ? currentSpecialization.name : 'none'
  };
}

// The Lambda handler function
export const handler = async (event) => {
  try {
    console.log('Received event:', JSON.stringify(event, null, 2));
    
    // Parse the user query from the event
    let userQuery;
    
    // Check if the event is from API Gateway
    if (event.body) {
      // Handle API Gateway request
      const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      userQuery = body.query || "No query provided";
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
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*', // For CORS support
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'OPTIONS,POST,GET'
      },
      body: {
        message: result.answer,
        conversationHistory: result.conversationHistory,
        metrics: result.metrics, 
        specialization: result.specialization
      }
    };
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
      body: {
        message: 'Error processing your request',
        error: error.message
      }
    };
  }
};

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

