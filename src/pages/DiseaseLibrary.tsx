import { useState, FormEvent, useEffect } from 'react'; // Added useEffect
import { Link } from 'react-router-dom'; // Import Link
import PageHeader from '@/components/PageHeader';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, ArrowLeft, Loader2, Info, Terminal } from 'lucide-react'; // Import Loader2, Info, Terminal
import { useFeatureAccess } from '@/hooks/useFeatureAccess'; // Added hook
import { FeatureName } from '@/lib/quotas'; // Import FeatureName from quotas.ts
import { useToast } from '@/components/ui/use-toast'; // Added toast
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"; // Added Alert
import { Skeleton } from "@/components/ui/skeleton";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"; // Import Accordion components
import ReactMarkdown from 'react-markdown'; // Import ReactMarkdown

interface SearchResultLinks {
  mayoClinic: string;
  medlinePlus: string;
}

const DiseaseLibrary = () => {
  const featureName: FeatureName = 'disease_library';
  // Get isLoadingToggles from the hook
  const { checkAccess, incrementUsage, isLoadingToggles } = useFeatureAccess();
  const { toast } = useToast();

  // State for initial access check
  const [isCheckingInitialAccess, setIsCheckingInitialAccess] = useState(true);
  const [initialAccessAllowed, setInitialAccessAllowed] = useState(false);
  const [initialAccessMessage, setInitialAccessMessage] = useState<string | null>(null);

  // Component state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<SearchResultLinks | null>(null);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false); // Loading state for search action
  const [apiError, setApiError] = useState<string | null>(null);
  const [detailedInfo, setDetailedInfo] = useState<string | null>(null);
  const [isDetailedLoading, setIsDetailedLoading] = useState<boolean>(false);
  const [detailedError, setDetailedError] = useState<string | null>(null);

  // Initial access check on mount
  useEffect(() => {
    // Only run verifyAccess if the hook is done loading toggles
    if (!isLoadingToggles) {
      const verifyInitialAccess = async () => {
        setIsCheckingInitialAccess(true); // Start page-specific check
        setInitialAccessMessage(null);
        try {
          // Check access without intending to increment yet
          const result = await checkAccess(featureName);
        // We only care if they have *any* access (quota > 0 or null)
        // The specific remaining count doesn't matter here, only for the search action itself.
         // We use result.quota !== 0 check to determine if the level allows access at all.
         if (result.quota === 0) { // Explicitly denied by level
              setInitialAccessAllowed(false);
              setInitialAccessMessage(result.message || 'Access denied for your level.');
         } else {
              setInitialAccessAllowed(true); // Allow rendering the search UI
         }

       } catch (error) {
         console.error("Error checking initial feature access:", error);
         setInitialAccessAllowed(false);
         setInitialAccessMessage('Failed to check feature access.');
         toast({
           title: "Error",
           description: "Could not verify feature access at this time.",
           variant: "destructive",
         });
       } finally {
          setIsCheckingInitialAccess(false); // Finish page-specific check
        }
      };
      verifyInitialAccess();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoadingToggles]); // Re-run when hook loading state changes


  const handleSearch = async (event: FormEvent) => {
    event.preventDefault();

    // --- Action Access Check ---
     const accessResult = await checkAccess(featureName);
     if (!accessResult.allowed) {
       toast({
         title: "Access Denied",
         description: accessResult.message || 'You cannot perform a search at this time.',
         variant: "destructive",
       });
       return; // Stop the search
    }
    // --- End Action Access Check ---

    const trimmedQuery = searchQuery.trim();
    if (!trimmedQuery) {
      setSearchResults(null);
      setAiSummary(null); // Clear AI summary
      setApiError(null); // Clear error
      return;
    }

    // Reset previous results/errors and set loading
    setSearchResults(null);
    setAiSummary(null); // Clear AI summary
    setApiError(null); // Clear error
    setDetailedInfo(null); // Clear detailed info
    setDetailedError(null); // Clear detailed error
    setIsLoading(true);

    const encodedQuery = encodeURIComponent(trimmedQuery);
    const mayoUrl = `https://www.mayoclinic.org/search/search-results?q=${encodedQuery}`;
    const medlineUrl = `https://vsearch.nlm.nih.gov/vivisimo/cgi-bin/query-meta?v%3Aproject=medlineplus&v%3Asources=medlineplus-bundle&query=${encodedQuery}`;

    // Set the direct search links immediately
    setSearchResults({
      mayoClinic: mayoUrl,
      medlinePlus: medlineUrl,
    });

    // Call the Netlify function to get AI summary
    try {
      const response = await fetch('/.netlify/functions/summarize-disease', { // Updated endpoint
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: trimmedQuery }),
      });

      const data = await response.json();

      if (!response.ok) {
        // Throw an error with the message from the function's response body
        throw new Error(data.error || `Function responded with status ${response.status}`);
      }

      setAiSummary(data.summary || "No summary generated."); // Store summary

    } catch (error: any) {
      console.error("Error calling summarize function:", error);
      setApiError(error.message || "Failed to fetch AI summary."); // Store error
    } finally {
      setIsLoading(false);
    }

    // --- Increment Usage ---
    // Increment only after confirming the search will proceed
    await incrementUsage(featureName);
     // Optionally show remaining quota after successful search
     // if (accessResult.remaining !== null) {
     //    const remainingAfterIncrement = accessResult.remaining - 1;
     //    toast({ title: "Info", description: `Remaining search quota for today: ${remainingAfterIncrement}` });
     // }
     // --- End Increment Usage ---
  };

  // Function to fetch detailed information
  // TODO: Consider if 'Explore More' should also consume a quota or have its own.
  // For now, it doesn't consume the 'disease_library' quota.
  const handleExploreMore = async () => {
    if (!searchQuery) return;

    setIsDetailedLoading(true);
    setDetailedInfo(null);
    setDetailedError(null);

    try {
      const response = await fetch('/.netlify/functions/get-disease-details', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ diseaseName: searchQuery.trim() }),
      });

      if (!response.ok) {
         console.error("[Explore More] Fetch response not OK:", response.status, response.statusText);
         let errorBody = "Could not read error body";
         try {
            errorBody = await response.text();
            console.error("[Explore More] Error response body:", errorBody);
         } catch (e) {
            console.error("[Explore More] Failed to read error response body:", e);
         }
         throw new Error(`Function responded with status ${response.status}. Body: ${errorBody}`);
       }

      const data = await response.json();
      setDetailedInfo(data.details || "No detailed information generated.");

     } catch (error: any) {
      console.error("[Explore More] Error in handleExploreMore:", error);
      setDetailedError(error.message || "Failed to fetch detailed information.");
    } finally {
      setIsDetailedLoading(false);
    }
  };

 // Helper function to parse the detailed info string into sections using block extraction
 const parseDetailedInfo = (details: string | null): Record<string, string> => {
    if (!details) return {};
    // Use Object.create(null) for a cleaner object without prototype chain
    const sections: Record<string, string> = Object.create(null);
    // Regex to find main headings (e.g., "1. **Heading:**") globally and capture the heading text
    const headingRegex = /^\d+\.\s*\*\*\s*(.+?)\s*:\*\*/gm; // g for global, m for multiline

    let match;
    const matches = [];
    // Find all heading matches and store their info (text and index)
    while ((match = headingRegex.exec(details)) !== null) {
        matches.push({
            title: match[1].trim(), // Captured group 1 is the heading text
            index: match.index,
            length: match[0].length // Length of the full heading match
        });
    }

    // Iterate through the found headings to extract content between them
    for (let i = 0; i < matches.length; i++) {
        const currentMatch = matches[i];
        const nextMatch = matches[i + 1];

        // Start index of content is after the current heading
        const contentStartIndex = currentMatch.index + currentMatch.length;

        // End index of content is the start of the next heading, or end of string
        const contentEndIndex = nextMatch ? nextMatch.index : details.length;

        // Extract the content substring and trim it
        const content = details.substring(contentStartIndex, contentEndIndex).trim();

        // Use the raw title directly as the key
        const sectionTitle = currentMatch.title;
        sections[sectionTitle] = content;
    }

    return sections;
 };


  const detailedSections = parseDetailedInfo(detailedInfo);

  return (
    <>
      <PageHeader
        title="Disease Information Search"
        subtitle="Search for disease information on Mayo Clinic and MedlinePlus."
      />

      <div className="container max-w-4xl mx-auto px-4 py-12">

        {/* Show Skeleton if overall loading is true */}
        {(isCheckingInitialAccess || isLoadingToggles) && (
           <div className="flex flex-col space-y-3 mt-4">
             <Skeleton className="h-[60px] w-full rounded-lg" />
             <Skeleton className="h-[100px] w-full rounded-lg" />
           </div>
         )}

         {/* Access Denied Message (Show only if NOT loading and access is denied) */}
         {!(isCheckingInitialAccess || isLoadingToggles) && !initialAccessAllowed && (
            <Alert variant="destructive" className="mt-4">
              <Terminal className="h-4 w-4" />
              <AlertTitle>Access Denied</AlertTitle>
              <AlertDescription>
                {initialAccessMessage || 'You do not have permission to access this feature.'}
              </AlertDescription>
            </Alert>
          )}

        {/* Render content only if NOT loading and access IS allowed */}
        {!(isCheckingInitialAccess || isLoadingToggles) && initialAccessAllowed && (
          <>
            {/* Disclaimer */}
            <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4 mb-8 text-justify" role="alert">
          <p className="font-bold">IMPORTANT DISCLAIMER:</p>
          <p>This tool provides links to external search results on authoritative sources (Mayo Clinic, MedlinePlus) for general informational purposes ONLY. It DOES NOT constitute medical advice, diagnosis, or treatment recommendation. Always consult with a qualified healthcare professional for any health concerns or before making any decisions related to your health or treatment.</p>
        </div>

        {/* Search Form */}
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2 mb-6">
          <Input
            type="text"
            placeholder="Enter disease or condition name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-grow"
            aria-label="Search for disease information"
          />
          <Button type="submit" className="bg-medical-teal hover:bg-medical-blue">
            {isLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Search className="mr-2 h-4 w-4" />
            )}
            {isLoading ? 'Searching...' : 'Search'}
          </Button>
        </form>

            {/* Loading Indicator */}
        {isLoading && (
          <div className="flex justify-center items-center mt-6">
            <Loader2 className="h-6 w-6 animate-spin text-medical-teal" />
            <span className="ml-2">Generating AI summary...</span>
          </div>
        )}

        {/* Direct Search Results Links - MOVED HERE */}
        {searchResults && !isLoading && (
          <div className="mt-6 p-4 border rounded-md bg-gray-100">
            <h3 className="text-lg font-semibold mb-3">Direct Search Links:</h3>
            <p className="mb-2">
              <a
                href={searchResults.mayoClinic}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline font-medium"
              >
                View search results on Mayo Clinic
              </a>
            </p>
            <p>
              <a
                href={searchResults.medlinePlus}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline font-medium"
              >
                View search results on MedlinePlus
              </a>
            </p>
          </div>
        )}

        {/* AI Summary or Error */}
        {!isLoading && (aiSummary || apiError) && (
          <div className="mt-6 p-4 border rounded-md bg-gray-50">
            <h3 className="text-lg font-semibold mb-3">AI Generated Summary for "{searchQuery}":</h3>
            {apiError ? (
              <p className="text-red-600">Error: {apiError}</p>
            ) : (
              <>
                {/* Render AI Summary using ReactMarkdown with justify */}
                <div className="prose prose-sm max-w-none text-justify">
                  <ReactMarkdown>
                    {aiSummary || ''}
                  </ReactMarkdown>
                </div>
                {/* Justify the summary disclaimer */}
                <p className="text-xs text-gray-500 mt-3 italic text-justify">Disclaimer: This summary was generated by AI and is for informational purposes only. Always consult the original sources and a healthcare professional.</p>
                {/* Explore More Button */}
                {aiSummary && !detailedInfo && !isDetailedLoading && !detailedError && ( // Show button only if summary exists
                   <Button
                     onClick={handleExploreMore}
                     variant="secondary"
                     className="mt-4"
                     disabled={isDetailedLoading}
                   >
                     <Info className="mr-2 h-4 w-4" /> Explore More Details
                   </Button>
                )}
              </>
            )}
          </div>
        )}

        {/* Detailed Information Loading Indicator */}
        {isDetailedLoading && (
          <div className="flex justify-center items-center mt-6">
            <Loader2 className="h-6 w-6 animate-spin text-medical-teal" />
            <span className="ml-2">Fetching detailed information...</span>
          </div>
        )}

         {/* Detailed Information Display or Error */}
         {!isDetailedLoading && (detailedInfo || detailedError) && (
           <div className="mt-6 p-4 border rounded-md bg-white">
              <h3 className="text-lg font-semibold mb-3">Detailed Information for "{searchQuery}":</h3>
              {detailedError ? (
                <p className="text-red-600">Error: {detailedError}</p>
             ) : detailedSections && Object.keys(detailedSections).length > 0 ? (
               <Accordion type="single" collapsible className="w-full">
                 {Object.entries(detailedSections).map(([title, content], index) => (
                   <AccordionItem value={title} key={title}>
                     <AccordionTrigger className="text-base font-medium hover:no-underline">
                       {/* Display the title from the object entry */}
                       {title}
                     </AccordionTrigger>
                     <AccordionContent className="text-sm text-gray-800 pt-2 pl-4">
                       {/* Restore ReactMarkdown and add text-justify class */}
                       <div className="prose prose-sm max-w-none text-justify">
                         <ReactMarkdown>
                           {content}
                         </ReactMarkdown>
                       </div>
                     </AccordionContent>
                   </AccordionItem>
                 ))}
               </Accordion>
             ) : (
                <p className="text-gray-600">Could not parse detailed information sections.</p>
             )}
             {/* Justify the detailed info disclaimer */}
             <p className="text-xs text-gray-500 mt-4 italic text-justify">Disclaimer: This detailed information was generated by AI and is for informational purposes only. Always consult the original sources and a healthcare professional.</p>
          </div>
        )}
          </>
        )} {/* End of initialAccessAllowed block */}

      </div>

      {/* Back Button Section */}
      <div className="flex justify-center mt-8 mb-12">
        <Link to="/tools">
          <Button variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Tools
          </Button>
        </Link>
      </div>
    </>
  );
};

export default DiseaseLibrary;
